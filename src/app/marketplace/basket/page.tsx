import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { authPageHref } from "@/lib/post-auth-redirect";
import { PublicShell } from "@/components/marketplace/public-shell";
import { basketCatalogue } from "@/lib/basket-catalogue";
import { getBasketAccountState } from "@/lib/basket-requests";
import { BasketView, type BasketAccount } from "@/components/marketplace/basket-view";

/**
 * /marketplace/basket: the request basket (coxwell 2026-10-03 via marcus m59124, rulings m59146;
 * Iris sheets 3-5 and r2 2-4). Public like the shelf: a visitor can build a basket, and "Sign in
 * to send →" brings them back here with it intact (localStorage, same origin).
 *
 * The page passes the catalogue (what may be in a basket today, with names) and, signed in, the
 * account facts the sheets need: trial eligibility (the five-source predicate, re-checked at
 * submit), whether a feed line could be switched on today, and the email we confirm on.
 *
 * NO PRICE, signed in or out (coxwell 10-14 via marcus m68871, m68882 A4): the page reads none, so no
 * amount can reach the payload. The bundle's portal_config price row may still exist; nothing reads it.
 */
export default async function BasketPage() {
  const session = await auth();
  const user = session?.user?.id ? session.user : null;
  if (user && isAdminUser(user)) redirect("/admin/basket-requests");

  const catalogue = basketCatalogue();
  const signInHref = authPageHref("/login", "/marketplace/basket");
  let account: BasketAccount | null = null;
  if (user) {
    const state = await getBasketAccountState(user.id);
    account = { email: state.email, trialEligible: state.trialEligible, feedReady: state.feedReady };
  }

  const page = (
    <>
      <div className="comm-head bk-page-head">
        <h1>Basket</h1>
        <p>Pick what you need and send it to us as one request. Nothing is charged.</p>
      </div>
      <BasketView catalogue={catalogue} account={account} signInHref={signInHref} />
      <div className="foot">HORIZON HFT · customer portal</div>
    </>
  );

  if (!user) return <PublicShell signInHref={signInHref}>{page}</PublicShell>;

  const isAdmin = false;
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
      {page}
    </PortalShell>
  );
}
