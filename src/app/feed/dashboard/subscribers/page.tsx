import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { AccountPackageRows } from "@/components/feed/account-package-rows";
import {
  listSubscribersForProvider,
  groupAccountSubscriptions,
  resolvedPriceCentsFor,
  startedAtForGroup,
  sumProviderShareCents,
} from "@/lib/feed-subscriptions";
import { providerShareFor } from "@/lib/feed-provider-packages";
import { FEED_REGION_LABELS, isFeedRegion } from "@/lib/feed-tier-catalogue";

const STATUS_ICON: Record<string, string> = { trial: "🧪", active: "✓", lapsed: "✗" };
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

/** Bus thread leo-provider-panel-package-labels-2026-09-05 (marcus, finding 3): countLabel's
 * bare-number shortcut (feeds === clients) reads fine standalone in the header cap, but "By
 * location" packs several of these into one sentence with no header nearby to disambiguate --
 * a bare "1 paying" there could mean 1 client or 1 feed. Always spell both nouns in that
 * context, and (unlike countLabel's hardcoded plural "feeds") pluralize correctly since a
 * single location can land on exactly 1 feed. */
function locationCountLabel(feeds: number, clients: number, word: string): string {
  return `${clients} ${word} client${clients === 1 ? "" : "s"} · ${feeds} feed${feeds === 1 ? "" : "s"}`;
}

/** Bus thread provider-feed-subscriber-linkage-2026-08-29, item 3. Pseudonym-only view --
 * see feed-subscriptions.ts's listSubscribersForProvider() for why no email/name/user_id
 * ever reaches this template. Reads real rows once migration 0071 is applied; the query
 * degrades to an empty list before that, so this page just shows the empty state today. */
export default async function FeedSubscribersPage() {
  const session = await auth();
  const providerId = session!.user!.id!;

  const subscribers = await listSubscribersForProvider(providerId);
  const accountGroups = groupAccountSubscriptions(subscribers);
  const payingCount = subscribers.filter((s) => s.status === "active").length;
  const trialCount = subscribers.filter((s) => s.status === "trial").length;
  const lapsedCount = subscribers.filter((s) => s.status === "lapsed").length;
  const payingClientCount = new Set(subscribers.filter((s) => s.status === "active").map((s) => s.pseudonym)).size;
  const trialClientCount = new Set(subscribers.filter((s) => s.status === "trial").map((s) => s.pseudonym)).size;
  const lapsedClientCount = new Set(subscribers.filter((s) => s.status === "lapsed").map((s) => s.pseudonym)).size;

  /** Job A2 (marcus/coxwell, bus thread leo-provider-subscribers-page-2026-09-06): "LD Base =
   * $30/mo and NY Base = $30/mo, flat 50/50" -- foots the same providerShareCentsFor()/-For()
   * pair every row cell already uses, so the total can never disagree with the sum a reader
   * would get by adding up the visible cells themselves. Job C: each row now resolves its OWN
   * price (client override only, no package/tier default -- m46504) via resolvedPriceCentsFor.
   * Per marcus's m46511/m46518 ruling, this calls sumProviderShareCents (feed-subscriptions.ts)
   * on the same accountGroups already in memory rather than reducing them here itself -- the
   * Overview card and Revenue's Total row call the identical function, so a lapsed row, a null
   * price, or a second region can't make this footer disagree with either of them. */
  const totalShareCents = sumProviderShareCents(accountGroups);

  const byLocation = new Map<
    string,
    { paying: number; trial: number; lapsed: number; payingClients: Set<string>; trialClients: Set<string>; lapsedClients: Set<string> }
  >();
  for (const s of subscribers) {
    const location = (s.regionKey && isFeedRegion(s.regionKey) && FEED_REGION_LABELS[s.regionKey]) || OTHER_LOCATION;
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
          <h1>Subscribers</h1>
          <div className="crumb">feed.horizonhft.com / subscribers</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        <div className="card full">
          <div className="chead">
            <span className="ic">◎</span>
            <h3>Subscribers</h3>
            <span className="cap">
              {countLabel(payingCount, payingClientCount, "paying")} · {money(totalShareCents)}/mo ·{" "}
              {countLabel(trialCount, trialClientCount, "trial")}
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
                      c.paying > 0 ? locationCountLabel(c.paying, c.payingClients.size, "paying") : null,
                      c.trial > 0 ? locationCountLabel(c.trial, c.trialClients.size, "trial") : null,
                      c.lapsed > 0 ? locationCountLabel(c.lapsed, c.lapsedClients.size, "lapsed") : null,
                    ].filter(Boolean);
                    return `${location}: ${parts.join("; ")}`;
                  })
                  .join("   |   ")}
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
                <tr className="note-row">
                  <td colSpan={6} className="r">
                    * Notional list-price split — there is no payout ledger or per-subscriber billing yet.
                  </td>
                </tr>
                {accountGroups.map((g) =>
                  g.kind === "package" ? (
                    <AccountPackageRows
                      key={`${g.pseudonym}-${g.label}`}
                      pseudonym={g.pseudonym}
                      label={g.label}
                      status={g.status}
                      share={providerShareFor(g.status, resolvedPriceCentsFor(g))}
                      serverIp={g.members[0].serverIp ?? null}
                      sinceISO={startedAtForGroup(g).toISOString().slice(0, 10)}
                      members={g.members.map((m) => ({
                        subscriptionId: m.subscriptionId,
                        tierName: m.tierName,
                        status: m.status,
                        startedAtISO: m.startedAt.toISOString().slice(0, 10),
                      }))}
                    />
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
                        {providerShareFor(g.row.status, resolvedPriceCentsFor(g))}
                      </td>
                      <td className="mono">{g.row.serverIp ?? ""}</td>
                      <td className="r mono">{g.row.startedAt.toISOString().slice(0, 10)}</td>
                    </tr>
                  )
                )}
                <tr className="total-row">
                  <td colSpan={3} className="r">
                    <b>Total</b>
                  </td>
                  <td className="r share">
                    <b>{money(totalShareCents)}</b>
                  </td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="foot">HORIZON HFT · provider panel · Subscribers</div>
      </section>
    </>
  );
}
