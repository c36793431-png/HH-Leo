import type { TierRequestState } from "@/components/feeds/tier-request-control";

/** One tier's slot on a request card: the state, and when the access behind a "granted" ends.
 * grantedUntil is null when nothing live dates it -- an approved envelope whose grant is not
 * (or no longer) live, or any non-granted state. */
export interface TierRequestStateEntry {
  state: TierRequestState;
  grantedUntil: Date | null;
}

/** A client's own live grant on one tier -- listLiveFeedTierGrantsForSubscriber's row. */
export interface LiveTierGrant {
  tierKey: string;
  regionKey: string;
  liveUntil: Date | null;
}

/** Per-tier request state from BOTH sources of "this client has it" (marcus ruling (a)(i), m53589).
 *
 * Envelopes alone missed every direct-granted client: an admin grant writes a feed_subscriptions
 * row with access_request_id NULL and no access_requests envelope, so the card read "none" and
 * rendered a live Request access button that assertNoLiveGrant then refused at submit
 * (DuplicateTierGrantError). @aylrn09 hit exactly that on 2026-09-24 (m53583) holding all three
 * Base tiers until 10-19.
 *
 * Precedence granted > pending, unchanged: a live grant wins over a pending envelope for the same
 * reason an approved one already did -- the access the client holds is the truer thing to show.
 * An approved envelope keeps reading granted with no live grant behind it, exactly as before; that
 * is a pre-existing over-claim this ruling did not ask to change.
 *
 * Grain is the ACCOUNT, not the server, same as the envelope arm has always been: a grant on any
 * of the client's servers marks the tier granted. A client holding a tier on one licence who wants
 * it on a second licence's server loses the button here and goes through an admin. */
export function deriveTierRequestStates(
  requests: { region: string; tierKey: string; status: string }[],
  liveGrants: LiveTierGrant[],
  region: string
): Map<string, TierRequestStateEntry> {
  const byTierKey = new Map<string, TierRequestStateEntry>();
  for (const r of requests) {
    if (r.region !== region) continue;
    if (r.status === "approved") {
      byTierKey.set(r.tierKey, { state: "granted", grantedUntil: null });
    } else if (r.status === "pending" && byTierKey.get(r.tierKey)?.state !== "granted") {
      byTierKey.set(r.tierKey, { state: "pending", grantedUntil: null });
    }
  }
  // Two live grants on one tier (two licences): the tier is held until the LATER one ends.
  for (const g of liveGrants) {
    if (g.regionKey !== region) continue;
    const prior = byTierKey.get(g.tierKey);
    const priorUntil = prior?.state === "granted" ? prior.grantedUntil : null;
    const grantedUntil =
      priorUntil == null ? g.liveUntil : g.liveUntil == null ? priorUntil : g.liveUntil > priorUntil ? g.liveUntil : priorUntil;
    byTierKey.set(g.tierKey, { state: "granted", grantedUntil });
  }
  return byTierKey;
}
