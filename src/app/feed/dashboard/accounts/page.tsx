import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { getActiveSubscriberCountForProvider, listSubscribersForProvider } from "@/lib/feed-subscriptions";

const STATUS_ICON: Record<string, string> = { trial: "🧪", active: "✓", lapsed: "✗" };

/** Bus thread provider-feed-subscriber-linkage-2026-08-29, item 3. Pseudonym-only view --
 * see feed-subscriptions.ts's listSubscribersForProvider() for why no email/name/user_id
 * ever reaches this template. Reads real rows once migration 0071 is applied; the query
 * degrades to an empty list before that, so this page just shows the empty state today. */
export default async function FeedAccountsPage() {
  const session = await auth();
  const providerId = session!.user!.id!;

  const [subscribers, activeCount] = await Promise.all([
    listSubscribersForProvider(providerId),
    getActiveSubscriberCountForProvider(providerId),
  ]);
  const lapsedCount = subscribers.filter((s) => s.status === "lapsed").length;

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
              {activeCount} · trial + active
              {lapsedCount > 0 ? ` · ${lapsedCount} lapsed (shown below)` : ""}
            </span>
          </div>

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
