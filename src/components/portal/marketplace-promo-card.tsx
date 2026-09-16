import Image from "next/image";
import Link from "next/link";
import {
  MARKETPLACE_CATEGORY_ORDER,
  MARKETPLACE_CATEGORY_LABELS,
} from "@/lib/marketplace-catalogue";

export interface MarketplacePromoCardProps {
  /** THE IMAGE IS CHOSEN and it is the free-tier hero's: coxwell via marcus, m51374 (2026-09-16),
   *  "yes reuse thats fine". It stays a prop rather than becoming a literal here because the page
   *  owns that choice for both of its top blocks and passes one constant to both
   *  (DASHBOARD_HERO_IMAGE, src/app/dashboard/page.tsx:55); a literal in this file would make this
   *  component a second producer of the string. These two are ONE ATOM -- an asset swap that
   *  leaves imageAlt behind describes an image that is not on the page -- so they are declared and
   *  passed together, never separately. */
  imageSrc: string;
  imageAlt: string;
  /** The shipped .hero .hero-image box is a fixed 340x210 with object-fit: cover
   *  (src/app/portal.css:278-282), so these default to that box and a replacement asset of
   *  another aspect ratio still fills it rather than reflowing the card. */
  imageWidth?: number;
  imageHeight?: number;
}

/**
 * The paid account's marketplace card for the top of /dashboard.
 *
 * coxwell's words, relayed by marcus (m50840, 2026-09-14): "paid users should have also
 * marketplace image in front upper area." A free account already gets a marketplace route from
 * the upgrade hero shipped in 9290dad; a paid account got none, because that hero is gated
 * !paid && !isAdmin (src/app/dashboard/page.tsx:245).
 *
 * IT REUSES THE .hero CLASSES AND STILL ADDS NO CSS. marcus cleared src/app/portal.css for this
 * card once the image was ruled on (m51374, 2026-09-16), and it turned out to need nothing: the
 * asset is byte-for-byte the hero's, and .hero .hero-image is a fixed 340x210 box with
 * object-fit: cover (src/app/portal.css:278-282), so the picture lands in the same box under the
 * same rules. The reuse is safe because the two blocks are MUTUALLY EXCLUSIVE -- the hero renders
 * only for !paid && !isAdmin and this card only for paid -- so at most one .hero exists on the
 * page, and the layout rules (including the <=breakpoint rule that hides .hero-image,
 * src/app/portal.css:1052) apply unchanged. `mkt-promo` carries no styling today; it stays the
 * hook for restyling this card away from the hero without touching the hero.
 *
 * NO COUNTS AND NO PRICES. The catalogue's listings drop out when their feed_tiers rows go
 * (src/app/marketplace/page.tsx:62-67), so a count rendered here would be a second, unfiltered
 * answer to "how many things are on the shelf". The category names come from the shipped
 * MARKETPLACE_CATEGORY_LABELS rather than being retyped, so a third category cannot appear on
 * /marketplace and be missing from this card's line.
 */
export function MarketplacePromoCard({
  imageSrc,
  imageAlt,
  imageWidth = 340,
  imageHeight = 210,
}: MarketplacePromoCardProps) {
  const categories = MARKETPLACE_CATEGORY_ORDER.map((c) => MARKETPLACE_CATEGORY_LABELS[c]).join(" · ");

  return (
    <div className="hero mkt-promo">
      <div className="hero-content">
        <div className="eyebrow">Marketplace</div>
        <h2>More from Horizon HFT than your licence opens</h2>
        {/* Says what the shelf HOLDS, not what this account already owns: nothing on the
            dashboard tells this component which feeds the reader has bought, so a line like
            "add feeds to your licence" would be a claim it cannot check. The terminal is the
            one thing it can state, because the catalogue states it -- the Horizon Terminal
            listing's blurb is "included with an active licence"
            (src/lib/marketplace-catalogue.ts:183). */}
        <p>
          Your licence includes the Horizon Terminal. The Marketplace lists everything else Horizon
          HFT sells, by category, with what is available today.
        </p>
        <div className="row">
          <Link className="btn primary" href="/marketplace">
            Browse the Marketplace
          </Link>
          <Link className="btn ghost" href="/feeds">
            See the feeds
          </Link>
        </div>
        <div className="row">
          <span className="note">{categories}</span>
        </div>
      </div>
      {/* `priority` MIRRORS THE FREE HERO, by ruling. marcus, m51383 (2026-09-16): "whatever the
          free hero does about preload, the paid card does the same" -- a paid account should not
          lose an LCP preload a free account gets. The free hero sets it on its own <Image>
          (src/app/dashboard/page.tsx:267), so this sets it the same way rather than taking it as a
          prop: the two blocks are mutually exclusive and occupy the same above-the-fold slot, and
          the box is the same one under the same rules (.portal-shell .hero .hero-image, fixed
          340x210, src/app/portal.css:278-282; hidden at the <=breakpoint, src/app/portal.css:1052)
          -- both selectors match this card, because its class is `hero mkt-promo`. The preload
          fires below that breakpoint for this card exactly as it already does for the hero; that
          is the symmetry, not a new cost. */}
      <div className="hero-image">
        <Image src={imageSrc} alt={imageAlt} width={imageWidth} height={imageHeight} priority />
      </div>
    </div>
  );
}
