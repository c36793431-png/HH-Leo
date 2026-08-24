import { pool } from "./db";

// /admin/providers "Needs terms review" queue -- spec §2/§3.2 (Iris, bus thread
// provider-terms-negotiation-2026-08-24, m29314 [1/3] + m29329 REVISED). One row per
// still-proposed round (the latest round for a given application_id + tier_name), never
// per application -- a provider can have several tiers negotiating in parallel (§3.5).

const THIN_MARGIN_THRESHOLD_PCT = 30;

export interface TermsQueueRow {
  proposalId: string;
  applicationId: string;
  providerUserId: string;
  providerName: string;
  tierName: string;
  roundNumber: number;
  context: "first proposal" | "revised after your note" | "renegotiation";
  clientPriceCents: number;
  providerSplitPct: number;
  trialLengthDays: number;
  createdAt: Date;
  adminRetainedPct: number;
  adminRetainedMonthlyCents: number;
  thinMargin: boolean;
  round1SplitPct: number;
  negotiationDeltaPct: number;
}

interface QueueDbRow {
  id: string;
  application_id: string;
  provider_user_id: string;
  provider_name: string;
  tier_name: string;
  client_price_cents: number;
  provider_split_pct: number;
  trial_length_days: number;
  created_at: Date;
  round_number: string;
  prev_declined_note: string | null;
  round1_split_pct: number;
}

function mapQueueRow(row: QueueDbRow): TermsQueueRow {
  const adminRetainedPct = 100 - row.provider_split_pct;
  const roundNumber = Number(row.round_number);
  const context: TermsQueueRow["context"] =
    roundNumber === 1 ? "first proposal" : row.prev_declined_note ? "revised after your note" : "renegotiation";

  return {
    proposalId: row.id,
    applicationId: row.application_id,
    providerUserId: row.provider_user_id,
    providerName: row.provider_name,
    tierName: row.tier_name,
    roundNumber,
    context,
    clientPriceCents: row.client_price_cents,
    providerSplitPct: row.provider_split_pct,
    trialLengthDays: row.trial_length_days,
    createdAt: row.created_at,
    adminRetainedPct,
    adminRetainedMonthlyCents: Math.round((row.client_price_cents * adminRetainedPct) / 100),
    thinMargin: adminRetainedPct < THIN_MARGIN_THRESHOLD_PCT,
    round1SplitPct: row.round1_split_pct,
    negotiationDeltaPct: row.provider_split_pct - row.round1_split_pct,
  };
}

/** The "Needs terms review" filter: latest round per (application_id, tier_name),
 * scoped down to the ones still sitting at terms_status = 'proposed'. Oldest first --
 * the row that's been waiting longest surfaces at the top. */
export async function listTermsReviewQueue(): Promise<TermsQueueRow[]> {
  const result = await pool.query<QueueDbRow>(
    `with latest as (
       select distinct on (application_id, tier_name)
         id, application_id, provider_user_id, tier_name, client_price_cents,
         provider_split_pct, trial_length_days, terms_status, created_at
       from provider_tier_proposals
       order by application_id, tier_name, created_at desc
     )
     select
       l.id, l.application_id, l.provider_user_id, pa.name as provider_name, l.tier_name,
       l.client_price_cents, l.provider_split_pct, l.trial_length_days, l.created_at,
       (select count(*) from provider_tier_proposals p2
          where p2.application_id = l.application_id and p2.tier_name = l.tier_name) as round_number,
       (select p3.declined_note from provider_tier_proposals p3
          where p3.application_id = l.application_id and p3.tier_name = l.tier_name
            and p3.created_at < l.created_at
          order by p3.created_at desc limit 1) as prev_declined_note,
       (select p4.provider_split_pct from provider_tier_proposals p4
          where p4.application_id = l.application_id and p4.tier_name = l.tier_name
          order by p4.created_at asc limit 1) as round1_split_pct
     from latest l
     join provider_applications pa on pa.id = l.application_id
     where l.terms_status = 'proposed'
     order by l.created_at asc`
  );
  return result.rows.map(mapQueueRow);
}

export interface BookContext {
  medianRetainedPct: number | null;
  liveProviderTierCount: number;
}

/** §3.2's aggregate: where the book sits on retained margin across every confirmed
 * (live) tier, so a single proposal's split can be judged against the fleet instead
 * of in isolation. provider_tiers is confirmed-only by construction (no status
 * column there), so every row here is a live, retained-margin data point. */
export async function getBookContext(): Promise<BookContext> {
  const result = await pool.query<{ median_retained_pct: string | null; live_count: string }>(
    `select
       percentile_cont(0.5) within group (order by (100 - provider_split_pct)) as median_retained_pct,
       count(*) as live_count
     from provider_tiers`
  );
  const row = result.rows[0];
  return {
    medianRetainedPct: row?.median_retained_pct != null ? Number(row.median_retained_pct) : null,
    liveProviderTierCount: Number(row?.live_count ?? 0),
  };
}

export interface TermsQueueStats {
  needsTermsReviewCount: number;
  liveProvidersCount: number;
  confirmedThisMonth: number;
  horizonRetainedRunRateCents: number;
}

/** Stat strip. Horizon-retained is a contracted run-rate over live provider_tiers
 * (client_price_cents * retained%), not a reconciled-payments figure -- same
 * "contracted, not reconciled" honesty as the dashboard Revenue tile. */
export async function getTermsQueueStats(): Promise<TermsQueueStats> {
  const [needsReview, live, confirmed, retained] = await Promise.all([
    pool.query<{ count: string }>(
      `select count(*) as count from (
         select distinct on (application_id, tier_name) terms_status
         from provider_tier_proposals
         order by application_id, tier_name, created_at desc
       ) latest where terms_status = 'proposed'`
    ),
    pool.query<{ count: string }>(`select count(distinct provider_user_id) as count from provider_tiers`),
    pool.query<{ count: string }>(
      `select count(*) as count from provider_tier_proposals
       where terms_status = 'confirmed' and decided_at >= date_trunc('month', now())`
    ),
    pool.query<{ retained: string | null }>(
      `select sum(client_price_cents * (100 - provider_split_pct) / 100.0) as retained from provider_tiers`
    ),
  ]);

  return {
    needsTermsReviewCount: Number(needsReview.rows[0]?.count ?? 0),
    liveProvidersCount: Number(live.rows[0]?.count ?? 0),
    confirmedThisMonth: Number(confirmed.rows[0]?.count ?? 0),
    horizonRetainedRunRateCents: Math.round(Number(retained.rows[0]?.retained ?? 0)),
  };
}
