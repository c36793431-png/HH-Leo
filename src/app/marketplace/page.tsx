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
  LATENCY_SEGMENT_LABELS,
  listingDetailHref,
  listingLatencySegment,
} from "@/lib/marketplace-catalogue";
import {
  MarketplaceCategoryFilter,
  type MarketplaceSection,
} from "@/components/marketplace/marketplace-category-filter";
import { ListingFigures, listingFigureMembers } from "@/components/marketplace/listing-figures";
import { ListingMedia } from "@/components/marketplace/listing-media";
import { AddToBasketButton, StrategyPreselect } from "@/components/marketplace/basket-controls";
import { BundleCardFoot } from "@/components/marketplace/bundle-add-box";
import { basketCatalogue, bundleDetailHref, bundleFeedChoiceEntries, strategyEntryKeyForSlug } from "@/lib/basket-catalogue";
import { BUNDLES, BUNDLE_CARD_ART } from "@/lib/bundle-catalogue";
import { MAIN_SITE_URL } from "@/lib/main-site";
import { hasListedConsultantProfiles } from "@/lib/consultant-profiles";

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
 * Consulting & Services (consult S4; Fable N1 via marcus m71465) is NOT a section here: its listings
 * are people, on their own page, /marketplace/services. The row links it with one plain chip after the
 * section chips, and only while at least one service provider passes the listing gate
 * (hasListedConsultantProfiles), so it keeps this rule: a chip never leads to an empty set. Humans
 * only; Nova stays in its own Horizon AI category. No prices there either.
 */
export default async function MarketplacePage({ searchParams }: { searchParams: Promise<{ strategy?: string | string[] }> }) {
  const { strategy } = await searchParams;
  const session = await auth();
  // No account is a public visitor now, not a redirect to /login.
  const user = session?.user?.id ? session.user : null;
  if (user && isAdminUser(user)) redirect("/admin/dashboard");

  // One call of the shipped query per declared region. A region with no rows (tokyo today)
  // returns an empty list, which is why the declared listings below do not depend on it.
  const tierLists = await Promise.all(FEED_REGIONS.map((region) => getPublicTiersForRegion(region).catch(() => [])));
  // The Consulting & Services chip shows only while someone is listed (see the comment above). A failed read hides it.
  const servicesListed = await hasListedConsultantProfiles().catch(() => false);
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

  // What the request basket can carry today (available listings + strategies), from the same
  // catalogue the submit action validates against.
  const catalogue = basketCatalogue();
  const basketable = new Set(catalogue.filter((e) => e.kind === "software" || e.kind === "feed").map((e) => e.key));

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
                const segment = listingLatencySegment(listing);
                return (
                  <div key={listing.key} className={`card mkt-card mkt-${listing.availability}`}>
                    {/* Iris's card order (m52632 item 4): image with its flag or plate, then name,
                        one sentence and See more. The comparison score stays on the card. */}
                    <ListingMedia listing={listing} variant="card" />
                    <div className="mkt-top">
                      {/* The tiers pages' segment badge, same words and classes (m58671, m58778). */}
                      {segment && (
                        <span className={`ftd-segment-badge${segment === "institutional" ? " ftd-badge-amber" : ""}`}>
                          {LATENCY_SEGMENT_LABELS[segment]}
                        </span>
                      )}
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

                    {/* See more on every card, in the same place (coxwell via marcus, m52589). The
                        request basket adds "+ Add to basket" beside it on a card the basket can
                        carry (Iris sheet 1, marcus m59146); a card it can't carry gets a sentence,
                        not a greyed-out button. The listing's own action stays on its product page. */}
                    <div className="mkt-foot bk-foot">
                      <Link href={detailHref} className="btn ghost sm mkt-cta">
                        See more →
                      </Link>
                      {basketable.has(listing.key) ? (
                        <AddToBasketButton
                          kind={listing.category === "feeds" ? "feed" : "software"}
                          keyName={listing.key}
                          name={listing.title}
                        />
                      ) : (
                        <span className="bk-foot-note">
                          {listing.availability === "maintenance" ? "Paused for maintenance." : "Nothing to add right now."}
                        </span>
                      )}
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

  // Bundles FIRST (coxwell Q-L via marcus m66848; bundles S2 m67879): one card per bundle, at the FRONT of the
  // sections so its chip is the first after All. Not a MarketplaceCategory, like Strategies below. NO PRICE, signed
  // in or out: the page's own rule above stays whole, and the price lives on the basket steps only. See more and
  // "+ Add to basket" like a listing card (coxwell 10-14 via marcus m68725); signed in, Add opens the feed pick
  // (BundleCardFoot), signed out it goes through sign-in to the product page, where the pick is made. A bundle
  // none of whose feeds can be requested reads "Not available at this moment" (the catalogue's own label, Fable S2
  // C7), has no Add, and sorts after the available ones, the :104-107 ordering.
  const bundleCards = BUNDLES.map((b) => ({ bundle: b, available: catalogue.some((e) => e.kind === "bundle" && e.key === b.key) }));
  const bundleItems = [...bundleCards.filter((c) => c.available), ...bundleCards.filter((c) => !c.available)];
  if (bundleItems.length > 0) {
    sections.unshift({
      key: "bundles",
      label: "Bundles",
      content: (
        <div key="bundles" id="bundles" className="fp-section mkt-section">
          <h2 className="fp-section-title">Bundles</h2>
          <div className="mkt-grid">
            {bundleItems.map(({ bundle, available }) => {
              const availability = available ? "available" : "unavailable";
              const art = BUNDLE_CARD_ART[bundle.key];
              return (
                <div key={bundle.key} className={`card mkt-card mkt-${availability} bk-bundle-card`}>
                  <div className="bk-strategy-plate bk-strategy-plate-img">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={art.src960} srcSet={`${art.src640} 640w, ${art.src960} 960w`} sizes="320px" alt={art.alt} width={320} height={120} />
                  </div>
                  <div className="mkt-top">
                    <span className={`mkt-pill mkt-pill-${availability}`}>{MARKETPLACE_AVAILABILITY_LABELS[availability]}</span>
                  </div>
                  <h3 className="mkt-name">
                    <Link href={bundleDetailHref(bundle)} className="mkt-name-link">
                      {bundle.title}
                    </Link>
                  </h3>
                  <p className="mkt-desc">{bundle.blurb}</p>
                  {available && user ? (
                    <BundleCardFoot
                      bundleKey={bundle.key}
                      bundleTitle={bundle.title}
                      choices={bundleFeedChoiceEntries(bundle)}
                      detailHref={bundleDetailHref(bundle)}
                    />
                  ) : (
                    <div className="mkt-foot bk-foot">
                      <Link href={bundleDetailHref(bundle)} className="btn ghost sm mkt-cta">
                        See more →
                      </Link>
                      {available ? (
                        <Link href={authPageHref("/login", bundleDetailHref(bundle))} className="btn primary sm bk-add">
                          + Add to basket
                        </Link>
                      ) : (
                        <span className="bk-foot-note">Nothing to add right now.</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ),
    });
  }

  // Strategies as a live section under the shelf (Iris r2 sheet 1; marcus m59146/m59173): the
  // basket's strategy entries, data-driven so a "Base Strategy package" can replace them. Not a
  // MarketplaceCategory: the listings stay software|feeds, and this section is the basket's.
  const strategyEntries = catalogue.filter((e) => e.kind === "strategy");
  // ?strategy=<www slug> (marcus m59280). Unknown or repeated params resolve to null: no effect.
  const preselectKey = strategyEntryKeyForSlug(typeof strategy === "string" ? strategy : undefined);
  if (strategyEntries.length > 0) {
    sections.push({
      key: "strategies",
      label: "Strategies",
      content: (
        <div key="strategies" id="strategies" className="fp-section mkt-section">
          <h2 className="fp-section-title">
            Strategies <span className="bk-section-note">Included with a Horizon licence — add the ones you want and we&apos;ll set them up with you</span>
          </h2>
          <div className="mkt-grid">
            {strategyEntries.map((e) => (
              <div key={e.key} id={`strategy-${e.key}`} className="card mkt-card mkt-available bk-strategy-card">
                {e.cardImage ? (
                  <div className="bk-strategy-plate bk-strategy-plate-img" aria-hidden="true">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={e.cardImage} srcSet={e.cardImage2x ? `${e.cardImage} 1x, ${e.cardImage2x} 2x` : undefined} alt="" width={316} height={120} />
                  </div>
                ) : (
                  <div className="bk-strategy-plate" aria-hidden="true">
                    <span>Strategy</span>
                  </div>
                )}
                <h3 className="mkt-name">{e.name}</h3>
                <p className="mkt-desc">{e.blurb}</p>
                <div className="mkt-foot bk-foot">
                  <Link href={e.aboutHref ?? `${MAIN_SITE_URL}/strategies`} className="btn ghost sm mkt-cta">
                    See more →
                  </Link>
                  <AddToBasketButton kind="strategy" keyName={e.key} name={e.name} />
                </div>
              </div>
            ))}
          </div>
          {preselectKey && <StrategyPreselect keyName={preselectKey} />}
        </div>
      ),
    });
  }

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

      <MarketplaceCategoryFilter sections={sections} links={servicesListed ? [{ href: "/marketplace/services", label: "Consulting & Services" }] : []} />

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
