import { Fragment } from "react";
import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { listSubscribersForProvider, type ProviderSubscriberRow } from "@/lib/feed-subscriptions";
import { PACKAGES } from "@/lib/feed-provider-packages";

const STATUS_ICON: Record<string, string> = { trial: "🧪", active: "✓", lapsed: "✗" };
const REGION_LABELS: Record<string, string> = { london: "London", ny: "New York", cme: "CME", tokyo: "Tokyo" };
const OTHER_LOCATION = "Other";

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

  const subscribers = await listSubscribersForProvider(providerId);
  const accountGroups = groupAccountSubscriptions(subscribers);
  const payingCount = subscribers.filter((s) => s.status === "active").length;
  const trialCount = subscribers.filter((s) => s.status === "trial").length;
  const lapsedCount = subscribers.filter((s) => s.status === "lapsed").length;

  const byLocation = new Map<string, { paying: number; trial: number; lapsed: number }>();
  for (const s of subscribers) {
    const location = (s.regionKey && REGION_LABELS[s.regionKey]) || OTHER_LOCATION;
    const counts = byLocation.get(location) ?? { paying: 0, trial: 0, lapsed: 0 };
    counts[s.status === "active" ? "paying" : s.status]++;
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
              {payingCount} paying · {trialCount} trial
              {lapsedCount > 0 ? ` · ${lapsedCount} lapsed` : ""}
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
                      c.paying > 0 ? `${c.paying} paying` : null,
                      c.trial > 0 ? `${c.trial} trial` : null,
                      c.lapsed > 0 ? `${c.lapsed} lapsed` : null,
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
                        <td className="r" />
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
                      <td className="r mono">{g.row.startedAt.toISOString().slice(0, 10)}</td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="foot">HORIZON HFT · provider panel · Accounts</div>
      </section>
    </>
  );
}
