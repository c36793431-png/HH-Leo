import Image from "next/image";
import Link from "next/link";
import {
  MARKETPLACE_CATEGORY_ORDER,
  MARKETPLACE_CATEGORY_LABELS,
} from "@/lib/marketplace-catalogue";

export interface MarketplacePromoCardProps {
  /** THE IMAGE IS NOT CHOSEN YET, so it is a prop rather than a literal in this file.
   *  marcus, m50840 (2026-09-14): "coxwell has not answered simple-graphic vs real-asset.
   *  Build the card so the image is a swappable prop and ship it with whatever placeholder
   *  the codebase already uses -- do not invent art". Swapping the asset is then a one-line
   *  change at the call site, with no edit to this component. */
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
 * !paid && !isAdmin (src/app/dashboard/page.tsx:223).
 *
 * IT REUSES THE .hero CLASSES RATHER THAN ADDING CSS, and that is a deliberate call, not
 * laziness. src/app/portal.css is a file Leo edited in the same commit that shipped the hero
 * (9290dad, portal.css:272-277), so opening it here is a collision I have not been cleared for.
 * The reuse is safe because the two blocks are MUTUALLY EXCLUSIVE -- the hero renders only for
 * !paid && !isAdmin and this card only for paid -- so at most one .hero exists on the page, and
 * the layout rules (including the <=breakpoint rule that hides .hero-image, portal.css:1052)
 * apply unchanged. `mkt-promo` carries no styling today; it is the hook for restyling this card
 * away from the hero without touching the hero, once marcus rules on portal.css.
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
      <div className="hero-image">
        <Image src={imageSrc} alt={imageAlt} width={imageWidth} height={imageHeight} />
      </div>
    </div>
  );
}
