import type { FeedAccessCollected } from "@/lib/payments";

function usd(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

/** COLLECTED, the first of the admin queue's tiles (marcus m64288, ruling 4): money received for feed
 * access this calendar month, all-time underneath. Both come from payments rows of category
 * 'feed_access' (getFeedAccessCollected); "—" means no such rows, never $0. */
export function FeedCollectedTile({ collected }: { collected: FeedAccessCollected }) {
  return (
    <div className="fttr-stat collected">
      <div className="n">{usd(collected.monthUsd)}</div>
      <div className="l">collected</div>
      <div className="l">all-time {usd(collected.allTimeUsd)}</div>
    </div>
  );
}
