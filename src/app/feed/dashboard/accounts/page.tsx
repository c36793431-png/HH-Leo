import { Fragment } from "react";
import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { listSubscribersForProvider, type ProviderSubscriberRow } from "@/lib/feed-subscriptions";
import { listTiersForProvider } from "@/lib/feed-providers";
import { PACKAGES, groupTiers } from "@/lib/feed-provider-packages";

const STATUS_ICON: Record<string, string> = { trial: "🧪", active: "✓", lapsed: "✗" };
const REGION_LABELS: Record<string, string> = { london: "London", ny: "New York", cme: "CME", tokyo: "Tokyo" };
const OTHER_LOCATION = "Other";

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Bus thread leo-provider-panel-package-labels-2026-09-04 (marcus, follow-up A): since the
 * Job 2/3 regroup, one status count can mean either "N feeds" or "N clients" depending on
 * whether any client in that status holds more than one tier -- the two read the same before
 * grouping existed. Rather than silently pick a unit, show the feed count (unchanged) and only
 * add the client count when it actually differs from it, so the common case stays a single
 * plain number and only the ambiguous case grows a qualifier. */
function countLabel(feeds: number, clients: number, word: string): string {
  if (feeds === 0) return `0 ${word}`;
  if (feeds === clients) return `${feeds} ${word}`;
  return `${clients} ${word} client${clients === 1 ? "" : "s"} · ${feeds} feeds`;
}

/** Bus thread leo-provider-panel-package-labels-2026-09-04 (marcus, follow-up B): a package
 * group's header has no `started_at` of its own -- it's an aggregate of its members' rows --
 * so this reports the earliest member's date as the account's start with this package. */
function earliestStartedAt(members: ProviderSubscriberRow[]): Date {
  return members.reduce((earliest, m) => (m.startedAt < earliest ? m.startedAt : earliest), members[0].startedAt);
}

/** Provider's notional 50% share for one account row, bus thread
 * leo-provider-panel-package-labels-2026-09-04 (coxwell, Job 6): "50% of the payment is paid
 * to the feed provider ... for the paying clients not the trial." Blank (not $0) for anything
 * other than the page's own `status === "active"` (EFFECTIVE_STATUS_SQL, same predicate as the
 * Status badge) and for a row with no priceCents on record -- a $0 reads as "worth nothing",
 * a blank reads as "no payment applies", and this page's price data (sourced only from
 * feed_tiers via listTiersForProvider/groupTiers, see below) doesn't cover a provider_tier_id
 * self-serve row at all.
 *
 * Reuses groupTiers()'s own computed priceCents rather than re-deriving a package price here,
 * so there is exactly one place a package's list price can be wrong. Two things this number
 * gets right only by coincidence today, both worth knowing before trusting it as a real
 * payable: a package's priceCents is its first member tier's price, not a sum (see groupTiers
 * in feed-provider-packages.ts) -- if a package's member tiers are ever priced differently
 * this silently misstates the package; and the 50% is a hardcoded /2 with no stored
 * per-provider split term (unlike provider_tiers' own client_price_cents/provider_split_pct
 * for self-serve providers) -- a real per-provider split added later would need this function
 * updated too, not just its data source. There is no payout ledger and no per-subscriber
 * billing anywhere in the schema, so list price is the only number that exists here. */
function providerShareFor(status: ProviderSubscriberRow["status"], priceCents: number | null | undefined): string | null {
  if (status !== "active" || priceCents == null) return null;
  return money(Math.round(priceCents / 2));
}

type AccountRowGroup =
  | { kind: "package"; pseudonym: string; label: string; status: ProviderSubscriberRow["status"]; members: ProviderSubscriberRow[] }
  | { kind: "single"; row: ProviderSubscriberRow };

/** Mirrors groupTiers' package/single split (feed-provider-packages.ts) but scoped per
 * account instead of per provider -- Revenue groups every tier a provider sells, this groups
 * one client's own granted tiers, so a client holding all of LD Base's three tiers reads as
 * one group instead of three unrelated rows. A tier with no PACKAGES entry keeps its own row. */
function groupAccountSubscriptions(rows: ProviderSubscriberRow[]): AccountRowGroup[] {
  const byAccount = new Map<string, ProviderSubscriberRow[]>();
  for (const row of rows) {
    const list = byAccount.get(row.pseudonym) ?? [];
    list.push(row);
    byAccount.set(row.pseudonym, list);
  }

  const groups: AccountRowGroup[] = [];
  for (const [pseudonym, accountRows] of byAccount) {
    const used = new Set<string>();
    for (const pkg of PACKAGES) {
      const members = accountRows.filter((r) => r.tierKey && pkg.tierKeys.includes(r.tierKey));
      if (members.length === 0) continue;
      members.forEach((m) => used.add(m.subscriptionId));
      groups.push({ kind: "package", pseudonym, label: pkg.label, status: members[0].status, members });
    }
    for (const row of accountRows) {
      if (!used.has(row.subscriptionId)) groups.push({ kind: "single", row });
    }
  }
  return groups;
}

/** Bus thread provider-feed-subscriber-linkage-2026-08-29, item 3. Pseudonym-only view --
 * see feed-subscriptions.ts's listSubscribersForProvider() for why no email/name/user_id
 * ever reaches this template. Reads real rows once migration 0071 is applied; the query
 * degrades to an empty list before that, so this page just shows the empty state today. */
export default async function FeedAccountsPage() {
  const session = await auth();
  const providerId = session!.user!.id!;

  const [subscribers, tiers] = await Promise.all([
    listSubscribersForProvider(providerId),
    listTiersForProvider(providerId),
  ]);
  const accountGroups = groupAccountSubscriptions(subscribers);
  const payingCount = subscribers.filter((s) => s.status === "active").length;
  const trialCount = subscribers.filter((s) => s.status === "trial").length;
  const lapsedCount = subscribers.filter((s) => s.status === "lapsed").length;
  const payingClientCount = new Set(subscribers.filter((s) => s.status === "active").map((s) => s.pseudonym)).size;
  const trialClientCount = new Set(subscribers.filter((s) => s.status === "trial").map((s) => s.pseudonym)).size;
  const lapsedClientCount = new Set(subscribers.filter((s) => s.status === "lapsed").map((s) => s.pseudonym)).size;

  const tierGroups = groupTiers(tiers);
  const packagePriceByLabel = new Map(
    tierGroups.filter((g) => g.kind === "package").map((g) => [g.label, g.priceCents] as const)
  );
  const singlePriceByTierKey = new Map(
    tierGroups.filter((g) => g.kind === "single").map((g) => [g.tier.tierKey, g.tier.priceCents] as const)
  );

  const byLocation = new Map<
    string,
    { paying: number; trial: number; lapsed: number; payingClients: Set<string>; trialClients: Set<string>; lapsedClients: Set<string> }
  >();
  for (const s of subscribers) {
    const location = (s.regionKey && REGION_LABELS[s.regionKey]) || OTHER_LOCATION;
    const counts =
      byLocation.get(location) ??
      { paying: 0, trial: 0, lapsed: 0, payingClients: new Set<string>(), trialClients: new Set<string>(), lapsedClients: new Set<string>() };
    if (s.status === "active") {
      counts.paying++;
      counts.payingClients.add(s.pseudonym);
    } else if (s.status === "trial") {
      counts.trial++;
      counts.trialClients.add(s.pseudonym);
    } else {
      counts.lapsed++;
      counts.lapsedClients.add(s.pseudonym);
    }
    byLocation.set(location, counts);
  }

  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>Accounts</h1>
          <div className="crumb">feed.horizonhft.com / accounts</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        <div className="card full">
          <div className="chead">
            <span className="ic">◎</span>
            <h3>Subscribers</h3>
            <span className="cap">
              {countLabel(payingCount, payingClientCount, "paying")} · {countLabel(trialCount, trialClientCount, "trial")}
              {lapsedCount > 0 ? ` · ${countLabel(lapsedCount, lapsedClientCount, "lapsed")}` : ""}
            </span>
          </div>

          {subscribers.length > 0 && (
            <div className="scope-note">
              <span className="i">◈</span>
              <span>
                By location —{" "}
                {Array.from(byLocation.entries())
                  .map(([location, c]) => {
                    const parts = [
                      c.paying > 0 ? countLabel(c.paying, c.payingClients.size, "paying") : null,
                      c.trial > 0 ? countLabel(c.trial, c.trialClients.size, "trial") : null,
                      c.lapsed > 0 ? countLabel(c.lapsed, c.lapsedClients.size, "lapsed") : null,
                    ].filter(Boolean);
                    return `${location}: ${parts.join(", ")}`;
                  })
                  .join("  ·  ")}
              </span>
            </div>
          )}

          {subscribers.length === 0 ? (
            <div className="empty">
              <div className="eic">◎</div>
              <b>No subscribers yet</b>
              <p>
                Every account that subscribes to one of your tiers shows up here as a pseudonym — Horizon never
                surfaces a subscriber&apos;s name or email to providers.
              </p>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Tier</th>
                  <th>Status</th>
                  <th className="r">Your 50%*</th>
                  <th>Server IP</th>
                  <th className="r">Since</th>
                </tr>
              </thead>
              <tbody>
                {accountGroups.map((g) =>
                  g.kind === "package" ? (
                    <Fragment key={`${g.pseudonym}-${g.label}`}>
                      <tr>
                        <td>
                          <b className="mono">{g.pseudonym}</b>
                        </td>
                        <td>
                          <b>{g.label}</b>
                        </td>
                        <td>
                          <span className={`tb ${g.status}`}>
                            {STATUS_ICON[g.status] ?? "•"} {g.status}
                          </span>
                        </td>
                        <td className="r share">{providerShareFor(g.status, packagePriceByLabel.get(g.label))}</td>
                        <td className="mono">{g.members[0].serverIp ?? ""}</td>
                        <td className="r mono">{earliestStartedAt(g.members).toISOString().slice(0, 10)}</td>
                      </tr>
                      {g.members.map((m) => (
                        <tr key={m.subscriptionId}>
                          <td />
                          <td style={{ paddingLeft: 28 }}>{m.tierName}</td>
                          <td>
                            <span className={`tb ${m.status}`}>
                              {STATUS_ICON[m.status] ?? "•"} {m.status}
                            </span>
                          </td>
                          <td />
                          <td />
                          <td className="r mono">{m.startedAt.toISOString().slice(0, 10)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ) : (
                    <tr key={g.row.subscriptionId}>
                      <td>
                        <b className="mono">{g.row.pseudonym}</b>
                      </td>
                      <td>{g.row.tierName}</td>
                      <td>
                        <span className={`tb ${g.row.status}`}>
                          {STATUS_ICON[g.row.status] ?? "•"} {g.row.status}
                        </span>
                      </td>
                      <td className="r share">
                        {providerShareFor(g.row.status, g.row.tierKey ? singlePriceByTierKey.get(g.row.tierKey) : null)}
                      </td>
                      <td className="mono">{g.row.serverIp ?? ""}</td>
                      <td className="r mono">{g.row.startedAt.toISOString().slice(0, 10)}</td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}

          {subscribers.length > 0 && (
            <div className="scope-note">
              <span className="i">◈</span>
              <span>* Notional list-price split — there is no payout ledger or per-subscriber billing yet.</span>
            </div>
          )}
        </div>

        <div className="foot">HORIZON HFT · provider panel · Accounts</div>
      </section>
    </>
  );
}
