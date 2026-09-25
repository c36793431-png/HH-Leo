import { pool } from "./db";
import { sendEmail } from "./email";
import { isNotificationEnabled } from "./notification-prefs";
import {
  endpointsThatWouldClear,
  insertProposalEndpoints,
  readEndpoints,
  replaceTierEndpoints,
  type EndpointInput,
} from "./provider-tier-endpoints";

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

/** The array connection columns carried forward onto provider_tiers at confirm time (0083).
 * Kept off AdminRow deliberately: every other query in this file selects the terms columns
 * only, so widening AdminRow would type those rows for fields they never fetch. The four
 * scalar connection columns are no longer read or written by this file: they live on the
 * endpoint child tables and their position-0 mirror, both owned by provider-tier-endpoints.ts
 * (docs/specs/0091-tier-endpoints-design.md @ 6100dc0, section 4 :264-271, grep gate :278-287). */
interface ConnectionRow {
  regions: string[] | null;
  coverage: string[] | null;
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

/** Provider self-serve panel's "your submitted terms" list -- every round across every
 * tier for one application, newest first. Same narrow column list as
 * listProposalRoundsForTierProvider (no declined_note/decided_by): a provider can see
 * that a round was declined, never why -- that steering stays on Telegram per marcus's
 * ruling on declineProposalRound above. */
export async function listProposalsForApplicationProvider(applicationId: string): Promise<ProviderProposalRoundRow[]> {
  const result = await pool.query<ProviderRow>(
    `select id, tier_name, client_price_cents, provider_split_pct, trial_length_days,
            terms_status, created_at
     from provider_tier_proposals
     where application_id = $1
     order by created_at desc`,
    [applicationId]
  );
  return result.rows.map(mapProviderRow);
}

export class ProviderApplicationMismatchError extends Error {
  constructor() {
    super("That application isn't linked to your account.");
  }
}

/** Slice B's ownership gate (bus thread leo-provider-self-registration-scope-2026-09-10,
 * marcus's constraint: "ownership-gated to the caller's own application_id/provider_user_id
 * via the existing assertOwnsRequestTier pattern") -- same shape as feed-providers.ts's
 * assertOwnsRequestTier: re-check ownership server-side from the row itself, never trust
 * the applicationId a client form posts. Also requires 'approved' so a caller can't submit
 * terms against a pending/declined application by guessing its id. */
async function assertOwnsApplication(providerUserId: string, applicationId: string): Promise<void> {
  const result = await pool.query<{ user_id: string | null; status: string }>(
    `select user_id, status from provider_applications where id = $1`,
    [applicationId]
  );
  const row = result.rows[0];
  if (!row || row.user_id !== providerUserId || row.status !== "approved") {
    throw new ProviderApplicationMismatchError();
  }
}

export interface SubmitProposalInput {
  tierName: string;
  clientPriceCents: number;
  providerSplitPct: number;
  trialLengthDays: number;
  /** The round's connection endpoints, already parsed (parseEndpointsJson in
   * provider-tier-endpoints.ts): positions 0..n-1, host and port on every row, at most 8. */
  endpoints: EndpointInput[];
  regions: string[] | null;
  coverage: string[] | null;
}

/** The two array connection columns confirmProposalRound copies onto provider_tiers, paired
 * with the label the provider actually sees on their own form. The four scalar columns left
 * this list for the endpoint set guard (endpointsThatWouldClear, design 2.1 clauses 1 and 2),
 * whose labels live beside it in provider-tier-endpoints.ts for the same reason: an error that
 * says "compid" when the box is labelled "SenderCompID" sends them hunting for a field that
 * isn't there. */
const CONNECTION_FIELDS: ReadonlyArray<{
  label: string;
  column: keyof ConnectionRow;
  submitted: (input: SubmitProposalInput) => string[] | null;
}> = [
  { label: "Regions", column: "regions", submitted: (i) => i.regions },
  { label: "Coverage", column: "coverage", submitted: (i) => i.coverage },
];

/** An empty array counts as unset, not as a value: registerProviderTiers and older rows can
 * leave `{}` behind, and refusing a round to protect a zero-length array would block a submit
 * that destroys nothing. The proposal path can't produce one -- list() in the terms action
 * returns null rather than [] -- so this only ever softens the guard, never tightens it. */
function connectionValueIsSet(value: string[] | null): boolean {
  return value !== null && value.length > 0;
}

/** Which of a live tier's regions/coverage this submission would blank out, rendered as
 * "Label (current value)". Deliberately pure and exported apart from the query it feeds: with
 * provider_tiers empty there is no live row to drive the guard through the DB, so keeping the
 * decision free of the lookup is what makes it checkable at all rather than shipped on faith. */
export function connectionFieldsThatWouldClear(liveRow: ConnectionRow, input: SubmitProposalInput): string[] {
  return CONNECTION_FIELDS.filter(
    (f) => connectionValueIsSet(liveRow[f.column]) && !connectionValueIsSet(f.submitted(input))
  ).map((f) => `${f.label} (${(liveRow[f.column] ?? []).join(", ")})`);
}

/** The proposal writer. Until Slice B nothing in the codebase inserted into
 * provider_tier_proposals (the table was read-only since 0061 -- admin's review card,
 * decline/confirm, and the terms queue all assumed rows just appear). Slice B: a provider
 * proposes their own terms, post-approval, from their own panel -- coxwell's 08-28 ruling and
 * 09-10 restatement (see 12388f5/094b678/5c84441). Writes terms_status = 'proposed' only;
 * confirmProposalRound/declineProposalRound (admin-only) are the sole path to
 * 'confirmed'/'declined', untouched by this function. One active 'proposed' round per
 * (application, tier) at a time -- letting a second submission queue up behind an undecided
 * first would silently orphan it, since the terms queue and listSiblingProposedTiersAdmin both
 * key off "the latest row", not "the latest undecided row".
 *
 * Since 0091 (thread provider-tier-endpoints-2026-09-24) a round is one proposal row plus its
 * endpoint rows, written in one transaction: the proposal INSERT here (terms and
 * regions/coverage; the four scalar connection columns are not named in this file any more),
 * then insertProposalEndpoints in provider-tier-endpoints.ts, which inserts the rows and
 * mirrors position 0 onto the proposal's four parent columns until 0092. Before the write, the
 * live tier's endpoint set is read through the one reader and checked by endpointsThatWouldClear
 * (below), the successor of the per-column blank guard for the four. */
export async function submitProposalRound(
  providerUserId: string,
  applicationId: string,
  input: SubmitProposalInput
): Promise<void> {
  await assertOwnsApplication(providerUserId, applicationId);

  const tierName = input.tierName.trim();
  if (!tierName) throw new Error("Tier name is required.");
  if (!Number.isInteger(input.clientPriceCents) || input.clientPriceCents <= 0) {
    throw new Error("Enter a valid client price.");
  }
  if (!Number.isInteger(input.providerSplitPct) || input.providerSplitPct < 0 || input.providerSplitPct > 100) {
    throw new Error("Split % must be between 0 and 100.");
  }
  if (!Number.isInteger(input.trialLengthDays) || input.trialLengthDays < 0) {
    throw new Error("Trial length must be zero or more days.");
  }

  const existing = await pool.query<{ id: string }>(
    `select id from provider_tier_proposals
     where application_id = $1 and tier_name = $2 and terms_status = 'proposed'`,
    [applicationId, tierName]
  );
  if (existing.rowCount) throw new Error(`"${tierName}" already has a round awaiting review.`);

  // Null-overwrite guard (marcus, m49437, 2026-09-13). confirmProposalRound writes the round's
  // connection details onto provider_tiers as a replace-set, null and absence included, because
  // a blank proposal field means "not supplied", never "unchanged". That semantic is correct and
  // does not change here. Its consequence is what this guards: re-proposing an ALREADY-LIVE tier
  // with the connection boxes left empty silently nulls the endpoint details subscribers
  // connect against, and the provider gets a success toast for it. The fix belongs at submit --
  // refusing the round and naming what would go beats teaching the copy-forward to coalesce,
  // which would make "clear this field" inexpressible and reinterpret a deliberate blank as
  // "keep".
  //
  // Two guards on one input. The endpoint set is checked by endpointsThatWouldClear
  // (docs/specs/0091-tier-endpoints-design.md @ 6100dc0, section 2.1 clauses 1 and 2,
  // :124-142): a live host:port absent from the submission, fewer rows at a shared address, or
  // a set protocol/compid coming back blank at a matched address is refused, the echo naming
  // the address and the column, never the live value and never the note. Regions/coverage keep
  // the per-column guard above. The live rows come through the one reader with this provider
  // as the viewer, so the ownership check runs again against the tier row itself.
  //
  // Keyed on (application_id, tier_name), the same key confirmProposalRound resolves its
  // destination row with, so the two cannot disagree about which row is at risk. A tier with no
  // provider_tiers row -- every first round, the common case -- has nothing to destroy and is
  // not gated, so this cannot block onboarding. It covers hand-registered tiers as well as
  // confirmed-round ones: provider_tiers.application_id is `not null` (0060:18) and
  // registerProviderTiers sets it, so there is no provider_tiers row this lookup can miss.
  //
  // Deliberately a refusal and not a silent coalesce-to-current: the provider is told which
  // details are live, and re-enters the ones they want to keep. Removing a live endpoint or
  // clearing a live field is consequently not expressible from this form (design 2.2, a per-row
  // remove tick is a logged follow-up), and it routes through Horizon, who own the write to
  // provider_tiers anyway.
  const liveTier = await pool.query<{ id: string } & ConnectionRow>(
    `select id, regions, coverage
       from provider_tiers where application_id = $1 and tier_name = $2`,
    [applicationId, tierName]
  );
  const liveRow = liveTier.rows[0];
  if (liveRow) {
    const liveEndpoints =
      (await readEndpoints(pool, { userId: providerUserId, isAdmin: false }, { kind: "tier", ids: [liveRow.id] })).get(
        liveRow.id
      ) ?? [];
    const wouldClear = [
      ...endpointsThatWouldClear(liveEndpoints, input.endpoints),
      ...connectionFieldsThatWouldClear(liveRow, input),
    ];
    if (wouldClear.length) {
      throw new Error(
        `"${tierName}" is already live and this round would remove or blank its connection details. ` +
          `Re-enter what you want to keep, or ask Horizon to remove it — ${wouldClear.join(", ")}.`
      );
    }
  }

  // One transaction for the proposal row and its endpoint rows (marcus m54021, J4 = yes): a
  // round with its endpoints half-written is a round the admin would confirm blind.
  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query<{ id: string }>(
      `insert into provider_tier_proposals
         (application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
          trial_length_days, regions, coverage, terms_status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'proposed')
       returning id`,
      [
        applicationId,
        providerUserId,
        tierName,
        input.clientPriceCents,
        input.providerSplitPct,
        input.trialLengthDays,
        input.regions,
        input.coverage,
      ]
    );
    await insertProposalEndpoints(client, inserted.rows[0].id, input.endpoints);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
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
 * terms and regions/coverage onto provider_tiers -- update in place if a row for this
 * (application_id, tier_name) already exists (renegotiation of a live tier), otherwise insert
 * one (first confirmation) -- and replaces the tier's endpoint set with the round's rows
 * through provider-tier-endpoints.ts (replaceTierEndpoints, verification carry included).
 * Built against marcus's authoritative §5/§6 spec, bus thread
 * provider-terms-negotiation-2026-08-24 (m29333/m29343 reconciled); the connection
 * copy-forward is marcus's later go (m47739/m47740, 2026-09-10), and the four scalar columns
 * moved to the endpoint child table under 0091 (thread provider-tier-endpoints-2026-09-24).
 * See the comment at the branch for the null semantics. */
export async function confirmProposalRound(
  proposalId: string,
  adminUserId: string,
  providerSplitPctOverride?: number
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const proposalResult = await client.query<AdminRow & ConnectionRow>(
      `select id, application_id, provider_user_id, tier_name, client_price_cents,
              provider_split_pct, trial_length_days, terms_status, declined_note,
              decided_by, decided_at, created_at,
              regions, coverage
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

    // The tier row is locked for the replace-set below (fable's delta-2 plan ruling J3, m54043 via
    // marcus m54049: BUILD the FOR UPDATE, lock order proposal then tier, which is the order of
    // the proposal select above and this one). Two confirms racing on one tier would otherwise each
    // snapshot the same live endpoint rows, and the second delete-then-insert would carry
    // verification from rows the first had already replaced.
    const existingTier = await client.query<{ id: string }>(
      `select id from provider_tiers where application_id = $1 and tier_name = $2 for update`,
      [proposal.application_id, proposal.tier_name]
    );

    // Trial derivation (Iris, bus thread feed-admin-dashboard-build-2026-08-24): the arming
    // instant is confirmed_at, not proposal-created, so anchor trial_expires_at to the same
    // now() this statement stamps on confirmed_at. A trial-less round must clear
    // trial_expires_at and set status='live' explicitly -- re-confirming a later round must
    // not silently regress to the column default or leave a stale trial window in place.
    //
    // Connection copy-forward (marcus, m47739/m47740, 2026-09-10; regions/coverage added on his
    // withdrawal of the hold, 2026-09-10): regions/coverage are text[] on provider_tier_proposals
    // (0061:25-26) AND on provider_tiers (0083:56-57), so they are a straight same-type array
    // copy, not a delimiter decision. The free-text regions/coverage that WOULD need a split rule
    // live on provider_applications (0059:24-25) -- a different table, never read on this path.
    // marcus's no-parse ruling is scoped to that table and does not travel here just because the
    // column names match. Null is written as null on BOTH branches by design: a blank proposal
    // field means "not supplied", never "unchanged" (marcus, 2026-09-10); the guard against
    // blanking a live value sits at submit (submitProposalRound above).
    //
    // The four scalar connection columns and endpoint_verified are not in these statements any
    // more. The round's endpoint rows land on the tier's endpoint child table as a replace-set
    // with the verification carry keyed on the four-tuple (docs/specs/0091-tier-endpoints-design.md
    // @ 6100dc0, section 2.1 :93-103 and 2.2 :154-158), and the writer mirrors position 0 onto
    // the five parent columns until 0092 (section 3 step 2, :203-209). Tightening versus the
    // UPDATE this replaces, on purpose: it kept endpoint_verified across a compid-only edit; the
    // carry does not (2.1, :101-103).
    let tierId: string;
    if (existingTier.rows[0]) {
      tierId = existingTier.rows[0].id;
      await client.query(
        `update provider_tiers
         set client_price_cents = $2,
             provider_split_pct = $3,
             trial_length_days = $4,
             regions = $5,
             coverage = $6,
             confirmed_at = now(),
             status = case when $4::int > 0 then 'trial' else 'live' end,
             trial_expires_at = case when $4::int > 0 then now() + make_interval(days => $4::int) else null end
         where id = $1`,
        [tierId, proposal.client_price_cents, effectiveSplitPct, proposal.trial_length_days, proposal.regions, proposal.coverage]
      );
    } else {
      const insertedTier = await client.query<{ id: string }>(
        `insert into provider_tiers
           (application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
            trial_length_days, regions, coverage, confirmed_at, status, trial_expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now(),
                 case when $6::int > 0 then 'trial' else 'live' end,
                 case when $6::int > 0 then now() + make_interval(days => $6::int) else null end)
         returning id`,
        [
          proposal.application_id,
          proposal.provider_user_id,
          proposal.tier_name,
          proposal.client_price_cents,
          effectiveSplitPct,
          proposal.trial_length_days,
          proposal.regions,
          proposal.coverage,
        ]
      );
      tierId = insertedTier.rows[0].id;
    }

    // Confirm is admin-only (the action at src/app/admin/providers/actions.ts:27 gates it), so
    // the reader's viewer is the admin; the read runs on this client so it sees this transaction.
    const proposalEndpoints =
      (await readEndpoints(client, { userId: adminUserId, isAdmin: true }, { kind: "proposal", ids: [proposalId] })).get(
        proposalId
      ) ?? [];
    await replaceTierEndpoints(client, tierId, proposalEndpoints);

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
    if (email && (await isNotificationEnabled(proposal.provider_user_id, "tier_review_decision"))) {
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
