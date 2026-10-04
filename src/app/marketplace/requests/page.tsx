import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { authPageHref } from "@/lib/post-auth-redirect";
import { listBasketRequests } from "@/lib/basket-requests";
import { formatAbsoluteUtc } from "@/lib/format-time";

/**
 * /marketplace/requests: "My requests" (Iris r2 sheet 3; marcus m59173 item 6). Basket requests
 * only; it is not a feature-request board. One row per basket sent, newest first, its
 * lines listed, status Sent (cyan) or Handled (neutral grey, never green: handled can include a
 * no). Read-only; signed-in only.
 */
export default async function MyBasketRequestsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect(authPageHref("/login", "/marketplace/requests"));
  const user = session.user;
  if (isAdminUser(user)) redirect("/admin/basket-requests");

  const [requests, activeLicenses] = await Promise.all([
    listBasketRequests({ userId: user.id }),
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
        <p>Newest first · one row per request you sent.</p>
      </div>

      {requests.length === 0 ? (
        <div className="card bk-empty">
          <h2>No requests yet</h2>
          <p>You haven&apos;t sent a request yet. Pick software, strategies or feeds in the marketplace and send them together.</p>
          <Link href="/marketplace" className="btn primary sm">
            Browse the marketplace →
          </Link>
        </div>
      ) : (
        <div className="card bk-reqs">
          {requests.map((r) => (
            <div key={r.id} className="bk-req">
              <div className="bk-req-when">
                {formatAbsoluteUtc(r.submittedAt)}
                <small>{r.reference}</small>
              </div>
              <ul className="bk-req-lines">
                {r.lines.map((l) => (
                  <li key={`${l.kind}:${l.key}`}>
                    {l.name}
                    <span>
                      {" · "}
                      {l.kind === "feed" ? `${l.servers ?? 1} server${(l.servers ?? 1) === 1 ? "" : "s"}` : l.kind}
                    </span>
                  </li>
                ))}
                {r.hasTrial && <li className="bk-req-trial">Start with a 30-day trial</li>}
              </ul>
              <div className="bk-req-status">
                {r.status === "handled" ? (
                  <>
                    <span className="bk-pill bk-pill-handled">✓ Handled</span>
                    <small>We&apos;ve replied. See Telegram/email for what was agreed.</small>
                  </>
                ) : (
                  <>
                    <span className="bk-pill bk-pill-sent">● Sent</span>
                    <small>We have it. We&apos;ll confirm on Telegram/email.</small>
                  </>
                )}
              </div>
            </div>
          ))}
          <p className="fp-note bk-req-foot">
            One row per <b>request you sent</b>, not per product. <b>Sent</b> = we have it. <b>Handled</b>{" "}
            = we&apos;ve replied. It does <b>not</b> say every line was granted. What you have shows on your account.
          </p>
        </div>
      )}
      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
