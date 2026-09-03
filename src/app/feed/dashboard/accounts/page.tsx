import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { listSubscribersForProvider } from "@/lib/feed-subscriptions";

const STATUS_ICON: Record<string, string> = { trial: "🧪", active: "✓", lapsed: "✗" };
const REGION_LABELS: Record<string, string> = { london: "London", ny: "New York", cme: "CME", tokyo: "Tokyo" };
const OTHER_LOCATION = "Other";

/** Bus thread provider-feed-subscriber-linkage-2026-08-29, item 3. Pseudonym-only view --
 * see feed-subscriptions.ts's listSubscribersForProvider() for why no email/name/user_id
 * ever reaches this template. Reads real rows once migration 0071 is applied; the query
 * degrades to an empty list before that, so this page just shows the empty state today. */
export default async function FeedAccountsPage() {
  const session = await auth();
  const providerId = session!.user!.id!;

  const subscribers = await listSubscribersForProvider(providerId);
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
                {subscribers.map((s) => (
                  <tr key={s.subscriptionId}>
                    <td>
                      <b className="mono">{s.pseudonym}</b>
                    </td>
                    <td>{s.tierName}</td>
                    <td>
                      <span className={`tb ${s.status}`}>
                        {STATUS_ICON[s.status] ?? "•"} {s.status}
                      </span>
                    </td>
                    <td className="r mono">{s.startedAt.toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="foot">HORIZON HFT · provider panel · Accounts</div>
      </section>
    </>
  );
}
