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

/** The queue's inline "Confirm" hot path (§2): agrees a proposed round as-is, no card
 * open required. Stamps the round confirmed, then mirrors its terms onto provider_tiers
 * -- update in place if a row for this (application_id, tier_name) already exists
 * (renegotiation of a live tier), otherwise insert one (first confirmation).
 *
 * NOTE: the full §4 confirm/decline spec text wasn't in context when this was written --
 * this mutation shape (stamp the round + upsert provider_tiers.confirmed_at) is the
 * obvious reading of "Confirm" against the 0061 schema, not verified against Iris's
 * actual §4 copy. Flagged to marcus on the bus; re-check against §4 before trusting this
 * for anything beyond the queue smoke test. */
export async function confirmProposalRound(proposalId: string, adminUserId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const proposalResult = await client.query<AdminRow>(
      `select id, application_id, provider_user_id, tier_name, client_price_cents,
              provider_split_pct, trial_length_days, terms_status, declined_note,
              decided_by, decided_at, created_at
       from provider_tier_proposals where id = $1 for update`,
      [proposalId]
    );
    const proposal = proposalResult.rows[0];
    if (!proposal) throw new Error("Proposal round not found");
    if (proposal.terms_status !== "proposed") throw new Error("Proposal round is no longer proposed");

    await client.query(
      `update provider_tier_proposals
       set terms_status = 'confirmed', decided_by = $2, decided_at = now()
       where id = $1`,
      [proposalId, adminUserId]
    );

    const existingTier = await client.query<{ id: string }>(
      `select id from provider_tiers where application_id = $1 and tier_name = $2`,
      [proposal.application_id, proposal.tier_name]
    );

    if (existingTier.rows[0]) {
      await client.query(
        `update provider_tiers
         set client_price_cents = $2, provider_split_pct = $3, trial_length_days = $4, confirmed_at = now()
         where id = $1`,
        [existingTier.rows[0].id, proposal.client_price_cents, proposal.provider_split_pct, proposal.trial_length_days]
      );
    } else {
      await client.query(
        `insert into provider_tiers
           (application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
            trial_length_days, confirmed_at)
         values ($1, $2, $3, $4, $5, $6, now())`,
        [
          proposal.application_id,
          proposal.provider_user_id,
          proposal.tier_name,
          proposal.client_price_cents,
          proposal.provider_split_pct,
          proposal.trial_length_days,
        ]
      );
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
