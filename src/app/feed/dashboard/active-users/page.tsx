import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { listActiveTrialsForProvider } from "@/lib/feed-providers";

/** Split off from /feed/dashboard/users (bus thread users-approvals-nav-split-2026-09-02,
 * coxwell via marcus) -- clients with live access, separate from the Approvals queue.
 * Still backed by listActiveTrialsForProvider/feed_tier_trials, same data the old combined
 * page showed under "Active trials"; that term is already settled (used on the Overview
 * stat), so the card keeps it even though the nav tab is "Active Users". */
export default async function FeedActiveUsersPage() {
  const session = await auth();
  const providerId = session!.user!.id!;

  const activeTrials = await listActiveTrialsForProvider(providerId);

  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>Active Users</h1>
          <div className="crumb">feed.horizonhft.com / active-users</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        <div className="card full">
          <div className="chead">
            <span className="ic">◉</span>
            <h3>Active trials</h3>
            <span className="cap">{activeTrials.length} active</span>
          </div>

          {activeTrials.length === 0 ? (
            <div className="empty">
              <div className="eic">◉</div>
              <b>No active users yet</b>
              <p>Clients you approve will show up here once their tier access goes live.</p>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Tier</th>
                  <th>Status</th>
                  <th>Since</th>
                  <th className="r">Trial ends</th>
                </tr>
              </thead>
              <tbody>
                {activeTrials.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <b>{t.userEmail ?? "—"}</b>
                    </td>
                    <td>{t.tierName}</td>
                    <td>
                      <span className="tb trial">🧪 Trial</span>
                    </td>
                    <td className="mono">{t.trialStartedAt.toISOString().slice(0, 10)}</td>
                    <td className="r mono">{t.trialEndsAt.toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="foot">HORIZON HFT · provider panel · Active Users</div>
      </section>
    </>
  );
}
