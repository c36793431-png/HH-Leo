import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { PendingApprovalsList } from "@/components/feed/pending-approvals-list";
import { listPendingRequestsForProvider } from "@/lib/feed-providers";
import { providerApproveAction, providerRejectAction } from "./actions";

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
            <PendingApprovalsList
              pending={pending}
              approveAction={providerApproveAction}
              rejectAction={providerRejectAction}
            />
          )}
        </div>

        <div className="foot">HORIZON HFT · provider panel · Approvals</div>
      </section>
    </>
  );
}
