import type { FeedTierDetail } from "@/lib/feed-tiers";
import { formatTierLatency, isScoreRegion, tierFigureHeading } from "@/lib/feed-provider-packages";
import { scoreForTierKey } from "@/lib/feed-comparison-scores";
import type { MarketplaceListing } from "@/lib/marketplace-catalogue";

/** One figure row: what formatTierLatency needs, plus the name printed beside it. */
export type ListingFigureMember = Pick<FeedTierDetail, "regionKey" | "tierKey" | "name" | "latencyUs" | "speedDisplay">;

/**
 * The figure rows of a listing: its feed_tiers members, or, for a declared listing with a
 * scoreTierKey (Black), its own Horizon Feed Comparison entry. SAME SOURCE AS THE LONDON CARDS:
 * the row goes through formatTierLatency, which reads scoreForTierKey for a score region, exactly
 * as the tiers page's Black column does (coxwell via marcus, m52589: "black is missing the
 * comparison score"). regionKey is "london" because FOC13's scores are London's and Black is the
 * London tiers page's flagship. latencyUs and speedDisplay are never read on that path.
 */
export function listingFigureMembers(listing: MarketplaceListing, members: FeedTierDetail[]): ListingFigureMember[] {
  if (listing.scoreTierKey) {
    return [
      { regionKey: "london", tierKey: listing.scoreTierKey, name: listing.title, latencyUs: null, speedDisplay: "—" },
    ];
  }
  return members;
}

function hasFigure(m: ListingFigureMember): boolean {
  return isScoreRegion(m.regionKey) ? scoreForTierKey(m.tierKey) != null : m.latencyUs != null;
}

/**
 * The comparison-score / latency block on a marketplace card and its product page. One
 * component, so the shelf and the page cannot print different figures for the same product.
 *
 * The heading comes from the same lib as the figure (marcus, m50770): a score read as a latency
 * reverses which feed looks best. A null heading means the figures are not all one kind, and
 * they are dropped rather than shown under a guessed label.
 *
 * A listing none of whose members has a figure renders nothing. That is Chicago (one row, no
 * measured latency) and NY Base (two rows, latency_us null on both): the block would print a
 * heading over bare "—"s, which reads as broken next to the cards that carry a score (marcus,
 * m52813). A bundle with at least one figure still lists every member, "—" included.
 */
export function hasListingFigures(members: ListingFigureMember[]): boolean {
  if (!tierFigureHeading(members.map((m) => m.regionKey))) return false;
  return members.some(hasFigure);
}

export function ListingFigures({ members }: { members: ListingFigureMember[] }) {
  const heading = tierFigureHeading(members.map((m) => m.regionKey));
  if (!heading || !hasListingFigures(members)) return null;
  return (
    <div className="mkt-members">
      <span className="mkt-members-label">
        {heading.label}
        {heading.note && <span className="figure-direction-note">{` · ${heading.note}`}</span>}
      </span>
      {members.map((m) => (
        <div key={m.tierKey} className="mkt-member">
          <span className="mkt-member-name">{m.name}</span>
          <span className="mkt-member-figure">{formatTierLatency(m.regionKey, m)}</span>
        </div>
      ))}
    </div>
  );
}
