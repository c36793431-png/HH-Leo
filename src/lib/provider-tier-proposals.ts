import { pool } from "./db";
import { sendEmail } from "./email";

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

/** Review card entry point: look up one round plus the provider's display name, so the
 * page can then pull the full lineage via listProposalRoundsForTierAdmin. */
export async function getProposalRoundAdmin(
  proposalId: string
): Promise<(ProposalRoundRow & { providerName: string }) | null> {
  const result = await pool.query<AdminRow & { provider_name: string }>(
    `select p.id, p.application_id, p.provider_user_id, p.tier_name, p.client_price_cents,
            p.provider_split_pct, p.trial_length_days, p.terms_status, p.declined_note,
            p.decided_by, p.decided_at, p.created_at, pa.name as provider_name
     from provider_tier_proposals p
     join provider_applications pa on pa.id = p.application_id
     where p.id = $1`,
    [proposalId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...mapAdminRow(row), providerName: row.provider_name };
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

export interface SiblingProposedTierRow {
  tierName: string;
  clientPriceCents: number;
  providerSplitPct: number;
}

interface SiblingRow {
  tier_name: string;
  client_price_cents: number;
  provider_split_pct: number;
}

/** Spec §3.5 sibling-tier strip: this provider's other tiers still sitting at
 * terms_status = 'proposed', latest round each, excluding the tier the review card
 * is currently open on. Scoped by provider_user_id, not application_id -- a provider
 * can have more than one provider_applications row (the parked dupe-application data
 * problem), and a sibling tier can sit under a different application row than the one
 * the review card opened on. Scoping by application_id alone silently drops that
 * sibling, which is the same rendering defect fixed in the terms queue for round
 * lineage grouping (064126f), just in the other half of the feature. Note this is NOT
 * the round-lineage rule: lineage stays scoped to (application_id, tier_name) because a
 * round belongs to the application that produced it -- sibling tiers belong to the
 * provider. Marcus's ruling, bus thread provider-terms-negotiation-2026-08-24. */
export async function listSiblingProposedTiersAdmin(
  providerUserId: string,
  excludeTierName: string
): Promise<SiblingProposedTierRow[]> {
  const result = await pool.query<SiblingRow>(
    `select tier_name, client_price_cents, provider_split_pct from (
       select distinct on (tier_name)
         tier_name, client_price_cents, provider_split_pct, terms_status
       from provider_tier_proposals
       where provider_user_id = $1 and tier_name <> $2
       order by tier_name, created_at desc
     ) latest
     where terms_status = 'proposed'`,
    [providerUserId, excludeTierName]
  );
  return result.rows.map((r) => ({
    tierName: r.tier_name,
    clientPriceCents: r.client_price_cents,
    providerSplitPct: r.provider_split_pct,
  }));
}

/** Confirmed money never gets stored -- derive it at read time from the reviewed round.
 * Retained = client price minus the provider's cut of it (spec §6). */
export function calcRetainedCents(clientPriceCents: number, providerSplitPct: number): number {
  return clientPriceCents - Math.round((clientPriceCents * providerSplitPct) / 100);
}

/** The queue's inline "Confirm" hot path (§2), and the review card's Confirm action:
 * agrees a proposed round, optionally overriding provider_split_pct ("adjust the share
 * before confirming" -- per-confirm edit only, not a persistent admin-owned-rate mode;
 * the reviewed proposal row itself is never mutated beyond its own status/decision
 * fields, so the override never touches the audit trail). Stamps the round confirmed
 * (this is also what arms the trial clock -- provider_tiers.confirmed_at), then mirrors
 * terms onto provider_tiers -- update in place if a row for this (application_id,
 * tier_name) already exists (renegotiation of a live tier), otherwise insert one (first
 * confirmation). Built against marcus's authoritative §5/§6 spec, bus thread
 * provider-terms-negotiation-2026-08-24 (m29333/m29343 reconciled). */
export async function confirmProposalRound(
  proposalId: string,
  adminUserId: string,
  providerSplitPctOverride?: number
): Promise<void> {
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

    const effectiveSplitPct = providerSplitPctOverride ?? proposal.provider_split_pct;

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

    // Trial derivation (Iris, bus thread feed-admin-dashboard-build-2026-08-24): the arming
    // instant is confirmed_at, not proposal-created, so anchor trial_expires_at to the same
    // now() this statement stamps on confirmed_at. A trial-less round must clear
    // trial_expires_at and set status='live' explicitly -- re-confirming a later round must
    // not silently regress to the column default or leave a stale trial window in place.
    if (existingTier.rows[0]) {
      await client.query(
        `update provider_tiers
         set client_price_cents = $2,
             provider_split_pct = $3,
             trial_length_days = $4,
             confirmed_at = now(),
             status = case when $4::int > 0 then 'trial' else 'live' end,
             trial_expires_at = case when $4::int > 0 then now() + make_interval(days => $4::int) else null end
         where id = $1`,
        [existingTier.rows[0].id, proposal.client_price_cents, effectiveSplitPct, proposal.trial_length_days]
      );
    } else {
      await client.query(
        `insert into provider_tiers
           (application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
            trial_length_days, confirmed_at, status, trial_expires_at)
         values ($1, $2, $3, $4, $5, $6, now(),
                 case when $6::int > 0 then 'trial' else 'live' end,
                 case when $6::int > 0 then now() + make_interval(days => $6::int) else null end)`,
        [
          proposal.application_id,
          proposal.provider_user_id,
          proposal.tier_name,
          proposal.client_price_cents,
          effectiveSplitPct,
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

/** Decline (§5) -- a single write to the reviewed row, never a mutation of the
 * reviewed snapshot's terms and never an inserted round N+1: the declined round keeps
 * its own terms_status/declined_note/decided_by/decided_at, and that's the whole write.
 * "Spawns the pre-filled round N+1 draft" (spec §4) is a client-side render behaviour --
 * a tier with no active `proposed` row renders as a draft pre-filled from the latest
 * declined row -- not a persisted record; `draft` is never a terms_status value (0064
 * constraint: proposed | confirmed | declined only). The next proposal row is created
 * only when the provider actually submits it. declined_note is the only decline field,
 * admin-only, and is never selected by listProposalRoundsForTierProvider and never
 * interpolated into the notification -- the email below is a static template with no
 * slots, so it structurally cannot leak a reason. Steering happens on Telegram, not
 * in-app or by email. Marcus's ruling, bus thread provider-terms-negotiation-2026-08-24. */
export async function declineProposalRound(
  proposalId: string,
  adminUserId: string,
  declinedNote: string
): Promise<void> {
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
       set terms_status = 'declined', declined_note = $2, decided_by = $3, decided_at = now()
       where id = $1`,
      [proposalId, declinedNote, adminUserId]
    );

    const recipient = await client.query<{ email: string | null }>(
      `select email from users where id = $1`,
      [proposal.provider_user_id]
    );

    await client.query("commit");

    const email = recipient.rows[0]?.email;
    if (email) {
      await sendEmail(
        email,
        "Update on your Horizon feed-provider terms",
        "Your submitted terms weren't confirmed this round. A new draft round is ready for you to review and resubmit from your Horizon provider dashboard."
      ).catch(() => {});
    }
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
