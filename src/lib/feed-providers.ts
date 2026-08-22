import { pool } from "./db";
import { feedTierMeta } from "./feed-tier-catalogue";
import { listFeedTierRequests, approveFeedTierRequest, rejectFeedTierRequest, type FeedTierRequestRow } from "./feed-tier-requests";
import { listFeedTierTrials, type FeedTierTrialRow } from "./feed-tier-trials";

/** Provider-scoped views over the shared feed_tiers/feed_tier_requests/feed_tier_trials
 * tables (bus thread leo-provider-panel-implementation-2026-08-22) -- these tables model
 * Horizon's own regional latency catalogue, so "provider-owned" is just the tiers a given
 * feed_provider account has been assigned via feed_tiers.provider_user_id (0058). No new
 * request/trial tables -- approve here calls the exact same approveFeedTierRequest() /
 * insertFeedTierTrial() chain the admin queue uses, per the spec's reuse contract. */

export interface ProviderTierRow {
  id: string;
  tierKey: string;
  region: string;
  name: string;
  subtitle: string;
  priceCents: number | null;
  sortOrder: number;
}

export async function listTierKeysForProvider(providerUserId: string): Promise<string[]> {
  const result = await pool.query<{ tier_key: string }>(
    `select tier_key from feed_tiers where provider_user_id = $1`,
    [providerUserId]
  );
  return result.rows.map((r) => r.tier_key);
}

export async function listTiersForProvider(providerUserId: string): Promise<ProviderTierRow[]> {
  const result = await pool.query<{
    id: string;
    tier_key: string;
    region_key: string;
    name: string;
    subtitle: string;
    price_cents: number | null;
    sort_order: number;
  }>(
    `select id, tier_key, region_key, name, subtitle, price_cents, sort_order
     from feed_tiers where provider_user_id = $1 order by sort_order`,
    [providerUserId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    tierKey: r.tier_key,
    region: r.region_key,
    name: r.name,
    subtitle: r.subtitle,
    priceCents: r.price_cents,
    sortOrder: r.sort_order,
  }));
}

async function tierKeySetFor(providerUserId: string): Promise<Set<string>> {
  return new Set(await listTierKeysForProvider(providerUserId));
}

export async function listPendingRequestsForProvider(providerUserId: string): Promise<FeedTierRequestRow[]> {
  const owned = await tierKeySetFor(providerUserId);
  if (owned.size === 0) return [];
  const all = await listFeedTierRequests({ status: "pending" });
  return all.filter((r) => owned.has(r.tierKey));
}

export async function listActiveTrialsForProvider(providerUserId: string): Promise<FeedTierTrialRow[]> {
  const owned = await tierKeySetFor(providerUserId);
  if (owned.size === 0) return [];
  const all = await listFeedTierTrials({ trialStatus: "active" });
  return all.filter((t) => owned.has(t.tierKey));
}

export class ProviderTierMismatchError extends Error {
  constructor() {
    super("That request isn't for one of your tiers.");
  }
}

async function assertOwnsRequestTier(providerUserId: string, requestId: string): Promise<void> {
  const owned = await tierKeySetFor(providerUserId);
  const [row] = (await listFeedTierRequests({})).filter((r) => r.id === requestId);
  if (!row || !owned.has(row.tierKey)) throw new ProviderTierMismatchError();
}

/** Provider-approve — MUST stay on the exact same approveFeedTierRequest()/
 * insertFeedTierTrial() chain the admin queue uses (spec §3, commit 00601e4) so the
 * identical client activation email + bot ping fires. Ownership is re-checked here (not
 * just trusted from the UI) before delegating. */
export async function providerApproveFeedTierRequest(
  providerUserId: string,
  requestId: string,
  adminUrl: string
): Promise<FeedTierRequestRow> {
  await assertOwnsRequestTier(providerUserId, requestId);
  return approveFeedTierRequest(requestId, providerUserId, adminUrl);
}

export async function providerRejectFeedTierRequest(
  providerUserId: string,
  requestId: string,
  reason: string | null
): Promise<FeedTierRequestRow> {
  await assertOwnsRequestTier(providerUserId, requestId);
  return rejectFeedTierRequest(requestId, providerUserId, reason);
}

export function tierDisplayName(tierKey: string): string {
  return feedTierMeta(tierKey)?.name ?? tierKey;
}
