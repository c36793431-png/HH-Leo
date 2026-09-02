import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { FeedRequestRowActions } from "@/components/feed/feed-request-row-actions";
import { listPendingRequestsForProvider } from "@/lib/feed-providers";
import { providerApproveAction, providerRejectAction } from "./actions";
import { formatRelative } from "@/lib/format-time";

/** PRIMARY interaction screen (provider-panel-spec.md §2) -- the provider approves here,
 * off the old admin/coxwell queue. Approve fires the same insertFeedTierTrial() chain the
 * admin flow uses (see lib/feed-providers.ts providerApproveFeedTierRequest).
 *
 * Split off "Active users" (bus thread users-approvals-nav-split-2026-09-02, coxwell via
 * marcus) -- this page is Approvals only now; live-access clients moved to
 * /feed/dashboard/active-users. URL kept at /users (unchanged) since actions.ts's
 * revalidatePath/adminUrl and the Overview page's queue links all point here. */
export default async function FeedApprovalsPage() {
  const session = await auth();
  const providerId = session!.user!.id!;

  const pending = await listPendingRequestsForProvider(providerId);

  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>Approvals</h1>
          <div className="crumb">feed.horizonhft.com / users</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        <div className="card full">
          <div className="chead">
            <span className="ic">⚑</span>
            <h3>Pending your approval</h3>
            <span className="cap">{pending.length} requests · newest first</span>
          </div>

          {pending.length === 0 ? (
            <div className="empty">
              <div className="eic">✓</div>
              <b>Queue is clear</b>
              <p>New signups, trial requests, and paid subscriptions for your tiers will land here.</p>
            </div>
          ) : (
            <div className="q">
              {pending.map((r, i) => (
                <div className={`qrow${i === 0 ? " hi" : ""}`} key={r.id}>
                  <div className="qav">{(r.userEmail ?? "?").charAt(0).toUpperCase()}</div>
                  <div className="qwho">
                    <b>
                      {r.userEmail ?? "unknown"} <span className="tb trial">🧪 Request</span>
                    </b>
                    <div className="meta">
                      <em>{r.tierName}</em> · requested {formatRelative(r.createdAt)}
                      {r.serverName ? ` · ${r.serverName}` : ""}
                    </div>
                  </div>
                  <FeedRequestRowActions
                    requestId={r.id}
                    approveAction={providerApproveAction}
                    rejectAction={providerRejectAction}
                  />
                  {i === 0 && (
                    <div className="qexpand">
                      Approving calls <code>insertFeedTierTrial()</code> — the same helper the admin flow uses
                      — so the client gets the identical activation chain. You&apos;re approving directly; this
                      never routes through Horizon admin.
                      <div className="flow">
                        <span className="n act">You approve</span>
                        <span className="ar">→</span>
                        <span className="n">insertFeedTierTrial()</span>
                        <span className="ar">→</span>
                        <span className="n">client activation email</span>
                        <span className="ar">+</span>
                        <span className="n">client bot ping</span>
                        <span className="ar">→</span>
                        <span className="n">tier access live</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="foot">HORIZON HFT · provider panel · Approvals</div>
      </section>
    </>
  );
}
