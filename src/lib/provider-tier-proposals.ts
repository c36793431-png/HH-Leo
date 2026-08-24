import { pool } from "./db";

// Round lineage is scoped by (application_id, tier_name), never application_id alone.
// A provider can have several tiers negotiating in parallel (spec §3.5 -- "each proposal
// carries its own round lineage"); scoping by application_id alone interleaves Alpha's and
// Beta's rounds into one timeline and produces a wrong-looking split % history on the admin
// review card. See bus thread provider-terms-negotiation-2026-08-24 (marcus).

export interface ProposalRoundRow {
  id: string;
  applicationId: string;
  providerUserId: string;
  tierName: string;
  clientPriceCents: number;
  providerSplitPct: number;
  trialLengthDays: number;
  termsStatus: string;
  declinedNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

interface AdminRow {
  id: string;
  application_id: string;
  provider_user_id: string;
  tier_name: string;
  client_price_cents: number;
  provider_split_pct: number;
  trial_length_days: number;
  terms_status: string;
  declined_note: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
}

function mapAdminRow(row: AdminRow): ProposalRoundRow {
  return {
    id: row.id,
    applicationId: row.application_id,
    providerUserId: row.provider_user_id,
    tierName: row.tier_name,
    clientPriceCents: row.client_price_cents,
    providerSplitPct: row.provider_split_pct,
    trialLengthDays: row.trial_length_days,
    termsStatus: row.terms_status,
    declinedNote: row.declined_note,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

/** Admin/coxwell review lineage: the full round history for one tier's negotiation,
 * including declined_note and who decided. Never reuse this query shape for the
 * provider-facing lineage below -- a shared row shape is how declined_note leaks. */
export async function listProposalRoundsForTierAdmin(
  applicationId: string,
  tierName: string
): Promise<ProposalRoundRow[]> {
  const result = await pool.query<AdminRow>(
    `select id, application_id, provider_user_id, tier_name, client_price_cents,
            provider_split_pct, trial_length_days, terms_status, declined_note,
            decided_by, decided_at, created_at
     from provider_tier_proposals
     where application_id = $1 and tier_name = $2
     order by created_at`,
    [applicationId, tierName]
  );
  return result.rows.map(mapAdminRow);
}

export interface ProviderProposalRoundRow {
  id: string;
  tierName: string;
  clientPriceCents: number;
  providerSplitPct: number;
  trialLengthDays: number;
  termsStatus: string;
  createdAt: Date;
}

interface ProviderRow {
  id: string;
  tier_name: string;
  client_price_cents: number;
  provider_split_pct: number;
  trial_length_days: number;
  terms_status: string;
  created_at: Date;
}

function mapProviderRow(row: ProviderRow): ProviderProposalRoundRow {
  return {
    id: row.id,
    tierName: row.tier_name,
    clientPriceCents: row.client_price_cents,
    providerSplitPct: row.provider_split_pct,
    trialLengthDays: row.trial_length_days,
    termsStatus: row.terms_status,
    createdAt: row.created_at,
  };
}

/** Provider-facing lineage: same per-tier scoping, but a narrow explicit column list that
 * cannot return declined_note or decided_by -- structural isolation, not a filter applied
 * after the fact. Keep this column list in sync by hand; do not switch to select *. */
export async function listProposalRoundsForTierProvider(
  applicationId: string,
  tierName: string
): Promise<ProviderProposalRoundRow[]> {
  const result = await pool.query<ProviderRow>(
    `select id, tier_name, client_price_cents, provider_split_pct, trial_length_days,
            terms_status, created_at
     from provider_tier_proposals
     where application_id = $1 and tier_name = $2
     order by created_at`,
    [applicationId, tierName]
  );
  return result.rows.map(mapProviderRow);
}
