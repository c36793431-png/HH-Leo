import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAdminUser, isPartnerUser } from "@/lib/admin-users-panel";
import { getPendingPartnerApplicationForUser } from "@/lib/partner-applications";
import { SignOutButton } from "@/components/sign-out-button";

const PARTNER_HOST = "partner.horizonhft.com";

/** Auth gate for the partner self-service dashboard, split out from the shared /partner
 * wrapper so partner.horizonhft.com's root can render a public landing page without
 * requiring a session — see src/app/partner/page.tsx. */
export default async function PartnerDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!isPartnerUser(session.user) && !isAdminUser(session.user)) {
    // A signed-in user with a pending partner application gets a distinct "under review"
    // message instead of being bounced straight to the landing page (leo-partner-page-
    // broken-auth-buttons-2026-08-22). Reuses /partner/apply's own confirmation UI rather
    // than a whole new route -- see that page's ?status=pending branch.
    const pendingApplication = await getPendingPartnerApplicationForUser(
      session.user.id,
      session.user.email ?? null
    );
    if (pendingApplication) redirect("/partner/apply?status=pending");

    // On partner.horizonhft.com, proxy.ts rewrites every non-/partner path (including
    // /dashboard) into this tree, so redirecting a non-partner user to "/dashboard" here
    // would just loop back through the same gate. Send them to the apply page with an
    // explanatory banner instead of a silent bounce to "/" (leo-partner-page-broken-
    // auth-buttons-2026-08-22, bug 2). On portal.horizonhft.com (reached by visiting
    // /partner directly, unrewritten) "/dashboard" is their real destination, unchanged.
    const host = (await headers()).get("host") || "";
    const isPartnerHost = host === PARTNER_HOST || host.startsWith(`${PARTNER_HOST}:`);
    redirect(isPartnerHost ? "/partner/apply?status=not-a-partner" : "/dashboard");
  }

  // Padded/backgrounded container used to live in the shared src/app/partner/layout.tsx,
  // but that wrapper now needs to be full-bleed for the public landing page (page.tsx) --
  // moved here since dashboard/* is the only remaining consumer (auth-gate logic above
  // is unchanged, only this cosmetic wrapper moved).
  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center justify-end gap-3 text-xs text-zinc-500">
          <span>Signed in as {session.user.name?.trim() || session.user.email}</span>
          <SignOutButton className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" redirectTo="/partner" />
        </div>
        {children}
      </div>
    </div>
  );
}
