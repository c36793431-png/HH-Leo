import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { authPageHref } from "@/lib/post-auth-redirect";
import { PublicShell } from "@/components/marketplace/public-shell";
import { MARKETPLACE_AVAILABILITY_LABELS } from "@/lib/marketplace-catalogue";
import { basketEntry, bundleDetailHref, bundleFeedChoiceEntries } from "@/lib/basket-catalogue";
import { bundleIncludedLines, type BundleDefinition } from "@/lib/bundle-catalogue";
import { BundleAddBox } from "@/components/marketplace/bundle-add-box";

/**
 * /marketplace/<bundle key>: a bundle's product page (bundles S2, marcus BUILD GO m67879; plan part 1 (B)). The
 * listing route [key]/page.tsx hands a bundle key here before its own listingByKey, so every listing page is
 * unchanged.
 *
 * Same shape as a listing's page (identity block, product left, Access right), with no comparison board and no
 * member stories. "What's included" is bundleIncludedLines: names read from the catalogues, never a price or a
 * tier price (coxwell "tier NAMES only", marcus M0 m67867).
 *
 * NO PRICE, signed in or out: it shows only at the basket steps (coxwell 10-14 via marcus m68725, "prices shown at
 * purchase, not on the page"). Signed out: "Sign in to request →", like every listing.
 */
export async function BundleProductPage({ bundle }: { bundle: BundleDefinition }) {
  const session = await auth();
  const user = session?.user?.id ? session.user : null;
  if (user && isAdminUser(user)) redirect("/admin/dashboard");

  // Available while at least one feed choice passes the feed line's own test (basketEntry is null otherwise).
  // Not available maps onto the catalogue's existing state and label (Fable S2 C7), never a new string.
  const available = basketEntry("bundle", bundle.key) != null;
  const availability = available ? "available" : "unavailable";
  const choices = bundleFeedChoiceEntries(bundle);
  const signInHref = authPageHref("/login", bundleDetailHref(bundle));

  const page = (
    <>
      <div className="comm-head">
        <Link href="/marketplace" className="btn ghost sm mkd-back">
          ← Marketplace
        </Link>
        <div className="mkd-title-row">
          <h1>{bundle.title}</h1>
          <span className={`mkt-pill mkt-pill-${availability}`}>{MARKETPLACE_AVAILABILITY_LABELS[availability]}</span>
        </div>
        <p>{bundle.blurb}</p>
      </div>

      <div className="mkd-grid">
        <div className="mkd-col">
          <div className="card">
            <div className="mkd-plate-title">What&apos;s included</div>
            <ul className="mkd-included">
              {bundleIncludedLines(bundle).map((item) =>
                typeof item === "string" ? (
                  <li key={item}>{item}</li>
                ) : (
                  <li key={item.label}>
                    <span className="mkd-included-label">{item.label}</span>
                    <ul>
                      {item.items.map((sub) => (
                        <li key={sub}>{sub}</li>
                      ))}
                    </ul>
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>

        <div className="mkd-side">
          <div id="request" className="card mkd-request">
            <div className="mkd-plate-title">Access</div>
            {!available ? (
              <p className="fp-note">Not open for requests right now.</p>
            ) : !user ? (
              <Link href={signInHref} className="btn primary sm mkd-action">
                Sign in to request →
              </Link>
            ) : (
              <BundleAddBox bundleKey={bundle.key} bundleTitle={bundle.title} choices={choices} />
            )}
          </div>
        </div>
      </div>

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
