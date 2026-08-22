import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdminUser, isFeedProviderUser } from "@/lib/admin-users-panel";
import { listPendingRequestsForProvider } from "@/lib/feed-providers";
import { FeedSidebar } from "@/components/feed/feed-sidebar";
import { FeedNavScrim } from "@/components/feed/feed-nav-toggle";
import { SignOutButton } from "@/components/sign-out-button";
import { ToastHost } from "@/components/admin/toast-host";
import "./feed-dashboard.css";

/** Auth gate + shell for the provider self-serve panel (feed.horizonhft.com), bus thread
 * leo-provider-panel-implementation-2026-08-22. Mirrors partner/dashboard/layout.tsx's
 * gate shape: redirect to /login if unauthenticated, 403-equivalent redirect if the
 * session isn't a feed_provider (or admin, for internal QA) account. No "pending
 * application" state exists for providers yet (onboarding is admin-assigned, per the
 * spec's "same auth pattern as consumer portal: signup -> admin activation -> login") --
 * a non-provider signed-in user just bounces to /dashboard. */
export default async function FeedDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!isFeedProviderUser(session.user) && !isAdminUser(session.user)) {
    redirect("/dashboard");
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
          signOutButton={<SignOutButton className="btn ghost sm fp-signout" redirectTo="/" />}
        />
        <main className="fp-main">{children}</main>
      </div>
      <ToastHost />
    </div>
  );
}
