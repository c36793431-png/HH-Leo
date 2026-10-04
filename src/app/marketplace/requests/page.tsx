import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { authPageHref } from "@/lib/post-auth-redirect";
import { listMyRequestsHistory, type HistoryStatus } from "@/lib/my-requests-history";
import { formatAbsoluteUtc } from "@/lib/format-time";

const PILL_CLASS: Record<HistoryStatus, string> = {
  Sent: "bk-pill-sent",
  "In review": "bk-pill-review",
  Approved: "bk-pill-approved",
  Declined: "bk-pill-declined",
  Handled: "bk-pill-handled",
  Active: "bk-pill-active",
  Ended: "bk-pill-ended",
};

/**
 * /marketplace/requests: "My requests" (Iris r2 sheet 3; marcus m59173 item 6), now the whole
 * history (coxwell 14:06Z via marcus m59959 (B); rulings m59979): every basket, Request access
 * click, feed and strategy idea, strategy pitch, trial and licence, newest first, one status
 * vocabulary (lib/my-requests-history.ts). Read-only; signed-in only. Handled stays neutral grey,
 * never green: handled can include a no.
 */
export default async function MyRequestsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect(authPageHref("/login", "/marketplace/requests"));
  const user = session.user;
  if (isAdminUser(user)) redirect("/admin/basket-requests");

  const [{ rows, failedSources }, activeLicenses] = await Promise.all([
    listMyRequestsHistory(user.id),
    getActiveLicenseDetailsForUser(user.id).catch(() => []),
  ]);
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(false, activeLicenses);

  return (
    <PortalShell
      tier={tier}
      isAdmin={false}
      userName={user.name ?? user.email ?? "trader"}
      userEmail={user.email ?? ""}
      hasOtherActiveTiers={hasOtherActiveTiers}
      switchablePanels={getReachablePanels(user.roles)}
    >
      <div className="comm-head">
        <h1>My requests</h1>
        <p>Newest first · everything you&apos;ve asked for, and the licences and trials you hold or held.</p>
      </div>

      {rows.length === 0 && failedSources.length === 0 ? (
        <div className="card bk-empty">
          <h2>No requests yet</h2>
          <p>You haven&apos;t sent a request yet. Pick software, strategies or feeds in the marketplace and send them together.</p>
          <Link href="/marketplace" className="btn primary sm">
            Browse the marketplace →
          </Link>
        </div>
      ) : (
        <div className="card bk-reqs">
          {rows.map((r) => (
            <div key={r.key} className="bk-req">
              <div className="bk-req-when">
                {formatAbsoluteUtc(r.at)}
                <small>{r.reference}</small>
              </div>
              <ul className="bk-req-lines">
                <li className="bk-req-kind">{r.kind}</li>
                {r.items.map((item, i) => (
                  <li key={i} className={item === "Start with a 30-day trial" ? "bk-req-trial" : undefined}>
                    {item}
                    {r.itemStatuses?.[i] && <span>{`: ${r.itemStatuses[i]}`}</span>}
                  </li>
                ))}
              </ul>
              <div className="bk-req-status">
                <span className={`bk-pill ${PILL_CLASS[r.status]}`}>{r.status}</span>
                {r.outcome && <small>{r.outcome}</small>}
              </div>
            </div>
          ))}
          {failedSources.length > 0 && (
            <p className="fp-note bk-req-foot">Part of your history couldn&apos;t be loaded just now. Refresh to try again.</p>
          )}
          <p className="fp-note bk-req-foot">
            <b>Sent</b> = we have it. <b>In review</b> = we&apos;re looking at it. <b>Handled</b>{" "}
            = we&apos;ve replied by email; it does <b>not</b> say every line was granted. <b>Active</b> / <b>Ended</b>{" "}
            = a licence or trial you hold or held.
          </p>
        </div>
      )}
      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
