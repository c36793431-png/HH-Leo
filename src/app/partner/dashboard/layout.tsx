import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAdminUser, isPartnerUser } from "@/lib/admin-users-panel";

const PARTNER_HOST = "partner.horizonhft.com";

/** Auth gate for the partner self-service dashboard, split out from the shared /partner
 * wrapper so partner.horizonhft.com's root can render a public landing page without
 * requiring a session — see src/app/partner/page.tsx. */
export default async function PartnerDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!isPartnerUser(session.user) && !isAdminUser(session.user)) {
    // On partner.horizonhft.com, proxy.ts rewrites every non-/partner path (including
    // /dashboard) into this tree, so redirecting a non-partner user to "/dashboard" here
    // would just loop back through the same gate. Send them to that host's own landing
    // page instead; on portal.horizonhft.com (reached by visiting /partner directly,
    // unrewritten) "/dashboard" is their real destination, unchanged from before.
    const host = (await headers()).get("host") || "";
    const isPartnerHost = host === PARTNER_HOST || host.startsWith(`${PARTNER_HOST}:`);
    redirect(isPartnerHost ? "/" : "/dashboard");
  }

  return <>{children}</>;
}
