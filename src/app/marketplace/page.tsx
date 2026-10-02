import Link from "next/link";
import { redirect } from "next/navigation";
import { Store } from "lucide-react";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { FEED_REGIONS } from "@/lib/feed-tier-catalogue";
import { getPublicTiersForRegion, type PublicFeedTier } from "@/lib/feed-tiers";
import { authPageHref } from "@/lib/post-auth-redirect";
import { PublicShell } from "@/components/marketplace/public-shell";
import {
  MARKETPLACE_LISTINGS,
  MARKETPLACE_CATEGORY_ORDER,
  MARKETPLACE_CATEGORY_LABELS,
  MARKETPLACE_AVAILABILITY_LABELS,
  listingDetailHref,
} from "@/lib/marketplace-catalogue";
import {
  MarketplaceCategoryFilter,
  type MarketplaceSection,
} from "@/components/marketplace/marketplace-category-filter";
import { ListingFigures, listingFigureMembers } from "@/components/marketplace/listing-figures";
import { ListingMedia } from "@/components/marketplace/listing-media";

/**
 * /marketplace — the catalogue of what Horizon sells (coxwell via marcus, 2026-09-14).
 *
 * Auth is /feeds' auth and deliberately NOT paidOnly: a catalogue of what we sell has to be
 * visible to a free account, or it is a page only existing customers can read (marcus, m50717 #3).
 *
 * NO PRICES, ANYWHERE ON THIS PAGE. Every shipped buyer surface renders none, and publishing one
 * would be the first feed price Horizon has ever shown a customer — coxwell's, not this errand's
 * (marcus ruling, m50723 #1; re-applied to Chicago's priced row, m52454 (a)).
 *
 * PUBLIC SINCE 2026-09-28 (coxwell via marcus, m55542/m55551): a signed-out visitor sees the same
 * shelf in PublicShell, and every way to request goes through sign-in, which returns them to the
 * page they were on. Signed in, nothing changed, admins included.
 *
 * NO NEW WHERE AND NO NEW DISPLAY RULE. Tiers come from getPublicTiersForRegion, a projection of
 * the shipped getTiersForRegion that shares its WHERE and ORDER but never selects price_cents: a
 * signed-out visitor can load this page, so the query itself keeps the price out rather than the
 * page's care in not rendering one (marcus, m55550 #2). A tier's figure is rendered by the
 * shipped formatTierLatency — London's feed_tiers.latency_us
 * holds FOC13's comparison SCORE rather than microseconds, so London renders "<score>/100" and
 * NY, whose latency_us is null, renders its bare "—" with no unit. Reusing the query is not by
 * itself enough to keep two surfaces agreeing, because the display rules live in the page, not
 * the lib — so this page reuses the rule too rather than restating it.
 *
 * That reuse did not extend to the HEADING, and the first cut shipped the figures under a
 * hand-written "Feed latency" — a score read as a latency, which reverses which feed looks best
 * (marcus, m50770). The heading now comes from tierFigureHeading in the same lib, so a surface
 * cannot label one thing and render another.
 *
 * THE CATEGORY FILTER ROW IS DERIVED, NOT DECLARED (Iris's design via marcus, 2026-09-16). The
 * chips are built from the sections this page is about to render, so a chip cannot select an
 * empty result set and a category that loses its last listing loses its chip in the same pass.
 * Her row also carries a fourth chip, `Consulting`, which is NOT here: there is no consulting
 * listing and MarketplaceCategory is deliberately "exactly the two coxwell named". A COMING SOON
 * chip is a claim that a product is on its way, which is the same claim this catalogue already
 * declines to make about Tokyo without a ruling (marcus, m50723). It is coxwell's word to give.
 */
export default async function MarketplacePage() {
  const session = await auth();
  // No account is a public visitor now, not a redirect to /login.
  const user = session?.user?.id ? session.user : null;
  if (user && isAdminUser(user)) redirect("/admin/dashboard");

  // One call of the shipped query per declared region. A region with no rows (tokyo today)
  // returns an empty list, which is why the declared listings below do not depend on it.
  const tierLists = await Promise.all(FEED_REGIONS.map((region) => getPublicTiersForRegion(region).catch(() => [])));
  const tierByKey = new Map(tierLists.flat().map((t) => [t.tierKey, t]));

  const listings = MARKETPLACE_LISTINGS.map((listing) => ({
    listing,
    members: listing.tierKeys
      .map((key) => tierByKey.get(key))
      .filter((t): t is PublicFeedTier => t != null),
  })).filter(
    // A DECLARED listing (no tier keys at all) always renders — that is the point of declaring
    // it. A tier-backed listing whose rows have all gone renders nothing rather than an empty
    // card still advertising the product.
    ({ listing, members }) => listing.tierKeys.length === 0 || members.length > 0
  );

  const sections: MarketplaceSection[] = MARKETPLACE_CATEGORY_ORDER.flatMap((category) => {
    const inCategory = listings.filter(({ listing }) => listing.category === category);
    // Available first, then every other state (coxwell 2026-10-02 via marcus, m58658). Two
    // filters rather than a sort so each group keeps the catalogue's order exactly. The test is
    // the same listing.availability the card's pill renders below (Black's is the value
    // blackAvailability() reads), so a listing that changes state moves with it.
    const items = [
      ...inCategory.filter(({ listing }) => listing.availability === "available"),
      ...inCategory.filter(({ listing }) => listing.availability !== "available"),
    ];
    // Same test as before the filter row existed: a category with nothing to show renders
    // nothing. It now also costs that category its chip — the chips come from this array.
    if (items.length === 0) return [];
    return [
      {
        key: category,
        label: MARKETPLACE_CATEGORY_LABELS[category],
        // Keyed here rather than at the call site: these nodes are rendered from an array, and
        // the key travels with the element.
        content: (
          <div key={category} className="fp-section mkt-section">
            <h2 className="fp-section-title">{MARKETPLACE_CATEGORY_LABELS[category]}</h2>
            <div className="mkt-grid">
              {items.map(({ listing, members }) => {
                const detailHref = listingDetailHref(listing);
                return (
                  <div key={listing.key} className={`card mkt-card mkt-${listing.availability}`}>
                    {/* Iris's card order (m52632 item 4): image with its flag or plate, then name,
                        one sentence and See more. The comparison score stays on the card. */}
                    <ListingMedia listing={listing} variant="card" />
                    <div className="mkt-top">
                      <span className={`mkt-pill mkt-pill-${listing.availability}`}>
                        {MARKETPLACE_AVAILABILITY_LABELS[listing.availability]}
                      </span>
                    </div>
                    <h3 className="mkt-name">
                      {/* The title and See more go to the same product page, one destination per
                          box (Iris sheet 1). */}
                      <Link href={detailHref} className="mkt-name-link">
                        {listing.title}
                      </Link>
                    </h3>
                    <p className="mkt-desc">{listing.blurb}</p>

                    <ListingFigures members={listingFigureMembers(listing, members)} />

                    {/* ONE control per card, the same on every card and in the same place,
                        bottom-right (coxwell via marcus, m52589). The listing's own action lives on
                        its product page, so a Not available card still has See more but its page
                        offers nothing to request. */}
                    <div className="mkt-foot">
                      <Link href={detailHref} className="btn ghost sm mkt-cta">
                        See more →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ),
      },
    ];
  });

  const signInHref = authPageHref("/login", "/marketplace");
  const page = (
    <>
      <div className="comm-head mkt-head">
        {/* The sidebar's own Marketplace glyph, not a second storefront mark — the same lucide
            Store the nav item renders (sidebar.tsx PORTAL_LINKS). Deliberately NOT the nav's
            #A78BFA accent: that colour means "this menu row is selected", and a page title is
            not a selection. No colour set, so it inherits the heading's own. */}
        <h1><Store size={24} strokeWidth={2} aria-hidden="true" /> Marketplace</h1>
        <p>Everything Horizon sells, by category — and what you can get today.</p>
      </div>

      <MarketplaceCategoryFilter sections={sections} />

      {user ? (
        <p className="fp-footnote">
          Availability shown here is the same state the rest of the portal renders. Need something
          that isn&apos;t listed? Ask on <Link href="/feeds">Feeds</Link> — we evaluate every request.
        </p>
      ) : (
        /* /feeds is not a sign-in destination (the allowlist is the marketplace only), so a
           visitor signs in back to here, and the signed-in footnote then links Feeds. */
        <p className="fp-footnote">
          Availability shown here is the same state the rest of the portal renders. Need something
          that isn&apos;t listed? <Link href={signInHref}>Sign in</Link> and ask on Feeds — we
          evaluate every request.
        </p>
      )}

      <div className="foot">HORIZON HFT · customer portal</div>
    </>
  );

  if (!user) return <PublicShell signInHref={signInHref}>{page}</PublicShell>;

  const switchablePanels = getReachablePanels(user.roles);
  const isAdmin = isAdminUser(user);
  const activeLicenses = await getActiveLicenseDetailsForUser(user.id).catch(() => []);
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const userName = user.name ?? user.email ?? "trader";
  const userEmail = user.email ?? "";

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      {page}
    </PortalShell>
  );
}
