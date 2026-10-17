import type { ReactNode } from "react";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { PublicShell } from "@/components/marketplace/public-shell";

/** The /marketplace pages' frame, as marketplace/page.tsx draws it: PublicShell for a signed-out visitor (the main
 * site's nav and a sign-in link), PortalShell for a signed-in one. Used by the Consulting & Services pages (S4). */
export async function MarketplaceFrame({ signInHref, children }: { signInHref: string; children: ReactNode }) {
  const session = await auth();
  const user = session?.user?.id ? session.user : null;
  if (!user) return <PublicShell signInHref={signInHref}>{children}</PublicShell>;

  const isAdmin = isAdminUser(user);
  const activeLicenses = await getActiveLicenseDetailsForUser(user.id).catch(() => []);
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  return (
    <PortalShell
      tier={tier}
      isAdmin={isAdmin}
      userName={user.name ?? user.email ?? "trader"}
      userEmail={user.email ?? ""}
      hasOtherActiveTiers={hasOtherActiveTiers}
      switchablePanels={getReachablePanels(user.roles)}
    >
      {children}
    </PortalShell>
  );
}
