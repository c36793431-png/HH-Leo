import { LISTING_MARK_ALT, listingMarkSrc, type MarketplaceListing } from "@/lib/marketplace-catalogue";

/**
 * A listing's image with its flag or plate bottom-left (Iris via marcus, m52632 item 2). One
 * component, so the shelf card and the product page cannot place the mark differently.
 *
 * Plain <img> for both, as the product page already did: static files from /public at a known
 * size. The width/height attributes reserve the box before the file arrives, so a slow image
 * cannot shift the See more row.
 *
 * THE MARK IS AN <img> OF IRIS'S FILE, NOT HER SVG PASTED INLINE. Her GB flag defines clipPath
 * ids (`gb-clip`, `gb-diag`), and the shelf shows three GB listings. Inline, those ids would
 * repeat in one document and every url(#gb-clip) would resolve to the first copy, which the
 * category filter can hide. As an <img> each file is its own document, and the bytes served are
 * the ones in her MANIFEST.
 *
 * Renders nothing without an image. A mark with no image has nothing to sit on, and every listing
 * with a mark has an image.
 */
export function ListingMedia({ listing, variant }: { listing: MarketplaceListing; variant: "card" | "hero" }) {
  if (!listing.image) return null;
  const [width, height] = variant === "card" ? [1024, 640] : [1024, 440];
  return (
    <div className={`mkt-media mkt-media-${variant}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="mkt-image" src={listing.image[variant]} alt={listing.image.alt} width={width} height={height} />
      {listing.mark && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="mkt-mark"
          src={listingMarkSrc(listing.mark)}
          alt={LISTING_MARK_ALT[listing.mark]}
          width={60}
          height={36}
        />
      )}
    </div>
  );
}
