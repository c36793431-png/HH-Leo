import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAdminUser, isFeedProviderUser } from "@/lib/admin-users-panel";
import { listPendingRequestsForProvider } from "@/lib/feed-providers";
import { getOtherPanels } from "@/lib/user-roles";
import { FeedSidebar } from "@/components/feed/feed-sidebar";
import { FeedNavScrim } from "@/components/feed/feed-nav-toggle";
import { SignOutButton } from "@/components/sign-out-button";
import { ToastHost } from "@/components/admin/toast-host";
import "./feed-dashboard.css";

const FEED_HOST = "feed.horizonhft.com";

/** Auth gate + shell for the provider self-serve panel (feed.horizonhft.com), bus thread
 * leo-provider-panel-implementation-2026-08-22. Mirrors partner/dashboard/layout.tsx's
 * gate shape: redirect to /login if unauthenticated, 403-equivalent redirect if the
 * session isn't a feed_provider account. No "pending application" state exists for
 * providers yet (onboarding is admin-assigned, per the spec's "same auth pattern as
 * consumer portal: signup -> admin activation -> login") -- a non-provider signed-in
 * user just bounces to /dashboard.
 *
 * Admin used to be admitted here for internal QA preview, but coxwell's ruling on
 * feed-admin-role-collision-fix-2026-08-24 is "admin has its own page" -- no dual-role,
 * no toggle, no QA-preview. proxy.ts now redirects admins off this subtree before they
 * ever reach this layout; this guard still excludes admin explicitly because on
 * portal.horizonhft.com the feed-host redirect in proxy.ts never fires, so without it an
 * admin could still walk in here via the portal host. Do not re-add the admission --
 * if preview access is needed again, that wants proper impersonation, not this. */
export default async function FeedDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (isAdminUser(session.user)) redirect("/admin/provider-applications");
  if (!isFeedProviderUser(session.user)) {
    // On feed.horizonhft.com, proxy.ts rewrites every non-/feed path (including /dashboard)
    // back into this tree, so redirecting a non-provider user to "/dashboard" here loops
    // forever -- ERR_TOO_MANY_REDIRECTS (leo-feed-dashboard-redirect-loop-2026-08-22).
    // There's no feed-host landing/apply page to bounce to instead (providers are
    // admin-onboarded, no self-serve flow like partner/apply exists yet), so send them
    // off-host to their real portal dashboard.
    const host = (await headers()).get("host") || "";
    const isFeedHost = host === FEED_HOST || host.startsWith(`${FEED_HOST}:`);
    redirect(isFeedHost ? "https://portal.horizonhft.com/dashboard" : "/dashboard");
  }

  const providerLabel = session.user.name?.trim() || session.user.email?.trim() || "Provider";
  const pending = await listPendingRequestsForProvider(session.user.id);

  return (
    <div className="feed-provider-v1">
      <FeedNavScrim />
      <div className="fp-app">
        <FeedSidebar
          providerLabel={providerLabel}
          providerEmail={session.user.email ?? null}
          pendingCount={pending.length}
          role={session.user.role ?? "user"}
          otherPanels={getOtherPanels(session.user.roles, "feed")}
          signOutButton={<SignOutButton className="btn ghost sm fp-signout" redirectTo="/" />}
        />
        <main className="fp-main">{children}</main>
      </div>
      <ToastHost />
    </div>
  );
}
