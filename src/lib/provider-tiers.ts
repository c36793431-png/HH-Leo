import { pool } from "./db";
import { getProviderApplication, notifyProviderLive } from "./provider-applications";
import {
  carryVerification,
  readEndpoints,
  writeTierEndpoints,
  type EndpointInput,
  type EndpointViewer,
  type LiveEndpoint,
} from "./provider-tier-endpoints";

export interface ProviderMarketplaceSummary {
  liveProviderCount: number;
  liveTierCount: number;
  retainedRunRateCents: number;
  grossRunRateCents: number;
}

/** Feed-admin dashboard Providers/Revenue tiles (bus thread
 * feed-admin-dashboard-build-2026-08-24). provider_tiers is confirmed-only by construction
 * (no status column -- see 0061's migration comment), so every row here is a live, real
 * data point -- same invariant getTermsQueueStats()/getBookContext() in
 * provider-terms-queue.ts rely on for the /admin/providers surface. This is a separate,
 * narrower query (dashboard only needs provider/tier counts + run-rate, not the terms-queue's
 * proposal/median-margin stats), not a reuse -- keep both in sync if provider_tiers' shape
 * changes.
 *
 * No paid-subscriber-count or payment/subscription table exists anywhere in this schema for
 * provider_tiers (verified against db/migrations/0060-0064 and every provider_tier* call
 * site) -- deliberately NOT surfaced here per Iris's spec's "real counts only" requirement.
 * Gross is computed alongside retained so the dashboard can swap its headline metric later
 * without a lib change (coxwell hasn't picked the permanent headline yet). */
export async function getProviderMarketplaceSummary(): Promise<ProviderMarketplaceSummary> {
  const result = await pool.query<{
    live_providers: string;
    live_tiers: string;
    gross: string | null;
    retained: string | null;
  }>(
    `select
       count(distinct provider_user_id) as live_providers,
       count(*) as live_tiers,
       sum(client_price_cents) as gross,
       sum(client_price_cents * (100 - provider_split_pct) / 100.0) as retained
     from provider_tiers`
  );
  const row = result.rows[0];
  return {
    liveProviderCount: Number(row?.live_providers ?? 0),
    liveTierCount: Number(row?.live_tiers ?? 0),
    grossRunRateCents: Math.round(Number(row?.gross ?? 0)),
    retainedRunRateCents: Math.round(Number(row?.retained ?? 0)),
  };
}

export interface LiveTierRevenueRow {
  id: string;
  providerName: string;
  tierName: string;
  clientPriceCents: number;
  providerSplitPct: number;
  providerPayoutCents: number;
  retainedCents: number;
}

/** Per-tier breakdown backing /admin/revenue (spec §9) -- the auditable detail behind
 * getProviderMarketplaceSummary()'s rollup. Same "provider_tiers is live-only by
 * construction" invariant applies, so no status filter is needed here either. */
export async function listAllLiveTiers(): Promise<LiveTierRevenueRow[]> {
  const result = await pool.query<{
    id: string;
    provider_name: string;
    tier_name: string;
    client_price_cents: number;
    provider_split_pct: number;
  }>(
    `select t.id, pa.name as provider_name, t.tier_name, t.client_price_cents, t.provider_split_pct
     from provider_tiers t
     join provider_applications pa on pa.id = t.application_id
     order by pa.name, t.tier_name`
  );
  return result.rows.map((row) => {
    const providerPayoutCents = Math.round(
      (row.client_price_cents * row.provider_split_pct) / 100
    );
    return {
      id: row.id,
      providerName: row.provider_name,
      tierName: row.tier_name,
      clientPriceCents: row.client_price_cents,
      providerSplitPct: row.provider_split_pct,
      providerPayoutCents,
      retainedCents: row.client_price_cents - providerPayoutCents,
    };
  });
}

/** Connection details as captured on provider_applications (0059) -- ONE set per provider,
 * describing the whole application, not any single tier. Every column is plain `text`, including
 * regions/coverage, and nothing normalizes them on the register-provider write path, so these are
 * carried and rendered verbatim. No split rule is applied to them here or anywhere downstream
 * (marcus, m47740: the live rows disagree on delimiter outright -- 'FX,COmmodities' vs
 * 'FX Majors - Metals - Indices - BTC' -- so no single rule was ever right). */
export interface ApplicationConnectionDetails {
  protocol: string | null;
  host: string | null;
  port: string | null;
  compid: string | null;
  regions: string | null;
  coverage: string | null;
}

/** Connection details as captured on provider_tiers -- PER TIER. regions/coverage are text[]
 * (0083), matching provider_tier_proposals, so these arrive already structured and need no
 * parsing. The connection endpoints (protocol, host, port, compid, the provider's note and the
 * per-row verified claim) are the tier's 0091 child rows, 0..8 of them, read through the one
 * reader in provider-tier-endpoints.ts, the only file that names the child tables (docs/specs/0091-tier-endpoints-design.md
 * @ 6100dc0, section 4 :264-271); the parent's four scalar columns are that reader's position-0
 * mirror until 0092 (section 3 step 2, :203-209) and are not read here any more. Written by
 * confirmProposalRound's replace-set and by registerProviderTiers (position 0 only, no compid,
 * see RegisterTierInput). A tier with zero rows falls back to the application grain at render
 * time (resolveEndpointsForDisplay). */
export interface TierConnectionDetails {
  endpoints: LiveEndpoint[];
  regions: string[];
  coverage: string[];
}

export interface ProviderRosterEntry {
  applicationId: string;
  providerName: string;
  status: "live" | "onboarding";
  source: "application" | "admin_manual";
  reviewedByLabel: string | null;
  applicationConnection: ApplicationConnectionDetails;
  tiers: {
    tierId: string;
    tierName: string;
    clientPriceCents: number;
    providerSplitPct: number;
    connection: TierConnectionDetails;
  }[];
}

/** /admin/providers roster table (bus thread feed-admin-dashboard-build-2026-08-24,
 * Iris's "roster is the index, terms-review is a filtered view inside it" reconciliation).
 * One row per approved application, tiers nested. Status is Live/Onboarding derived from
 * provider_applications.onboarded_at (NOT NULL = Live, NULL = Onboarding) -- the split
 * 0060's own migration comment names as "the Live/pending-onboarding split". Iris's spec
 * pointed at provider_tiers.published_at for this, but that column is `not null default
 * now()` and can never be NULL, so it can't carry a two-state distinction; onboarded_at is
 * the field that actually does. Base is provider_applications (status='approved') left-joined
 * to provider_tiers, not an inner join on provider_tiers, so onboarding applicants with zero
 * confirmed tiers still show up as a row instead of being invisible. Uptime remains unmodeled
 * -- same gap as the aggregate dashboard's dropped connections-state tile.
 *
 * Connection details are selected from BOTH tables at the grain each was actually captured, and
 * are NOT merged here (marcus's ruling, thread leo-provider-self-registration-scope-2026-09-10):
 * per-tier data stays per-tier, application-level data stays application-level, nothing is copied
 * onto provider_tiers to make it displayable. Fanning one application value onto N tier rows would
 * create copies with no writer to re-sync them -- right the day they are written and silently
 * wrong the moment a provider runs two tiers on different protocols. The two shapes stay distinct
 * in the return type so the caller has to state which one it is rendering.
 *
 * `viewer` is the caller's session as the endpoint reader wants it (design 4 [S3]): the roster
 * is admin-only by route (src/app/admin/layout.tsx:14-16), but the reader asserts on what it is
 * handed, not on the route, so the page passes its real session and a non-admin caller of this
 * function gets EndpointViewerError from the reader, not a roster. */
export async function listProviderRoster(viewer: EndpointViewer): Promise<ProviderRosterEntry[]> {
  const result = await pool.query<{
    application_id: string;
    provider_name: string;
    onboarded_at: Date | null;
    source: "application" | "admin_manual";
    reviewer_display_name: string | null;
    reviewer_email: string | null;
    app_protocol: string | null;
    app_host: string | null;
    app_port: string | null;
    app_compid: string | null;
    app_regions: string | null;
    app_coverage: string | null;
    tier_id: string | null;
    tier_name: string | null;
    client_price_cents: number | null;
    provider_split_pct: number | null;
    tier_regions: string[] | null;
    tier_coverage: string[] | null;
  }>(
    `select pa.id as application_id, pa.name as provider_name, pa.onboarded_at, pa.source,
            u.display_name as reviewer_display_name, u.email as reviewer_email,
            pa.protocol as app_protocol, pa.host as app_host, pa.port as app_port,
            pa.compid as app_compid, pa.regions as app_regions, pa.coverage as app_coverage,
            t.id as tier_id, t.tier_name, t.client_price_cents, t.provider_split_pct,
            t.regions as tier_regions, t.coverage as tier_coverage
     from provider_applications pa
     left join users u on u.id = pa.reviewed_by
     left join provider_tiers t on t.application_id = pa.id
     where pa.status = 'approved'
     order by pa.name, t.tier_name`
  );

  const byApplication = new Map<string, ProviderRosterEntry>();
  for (const row of result.rows) {
    let entry = byApplication.get(row.application_id);
    if (!entry) {
      entry = {
        applicationId: row.application_id,
        providerName: row.provider_name,
        status: row.onboarded_at != null ? "live" : "onboarding",
        source: row.source,
        reviewedByLabel:
          row.source === "admin_manual"
            ? row.reviewer_display_name || row.reviewer_email?.split("@")[0] || "an admin"
            : null,
        applicationConnection: {
          protocol: row.app_protocol,
          host: row.app_host,
          port: row.app_port,
          compid: row.app_compid,
          regions: row.app_regions,
          coverage: row.app_coverage,
        },
        tiers: [],
      };
      byApplication.set(row.application_id, entry);
    }
    if (
      row.tier_id != null &&
      row.tier_name != null &&
      row.client_price_cents != null &&
      row.provider_split_pct != null
    ) {
      entry.tiers.push({
        tierId: row.tier_id,
        tierName: row.tier_name,
        clientPriceCents: row.client_price_cents,
        providerSplitPct: row.provider_split_pct,
        connection: {
          endpoints: [],
          regions: row.tier_regions ?? [],
          coverage: row.tier_coverage ?? [],
        },
      });
    }
  }
  const entries = Array.from(byApplication.values());

  // One round trip for every tier on the roster; the reader asserts the viewer per tier id
  // before its SELECT and returns an entry (possibly []) for every id asked.
  const tierIds = entries.flatMap((entry) => entry.tiers.map((tier) => tier.tierId));
  const endpointsByTier = await readEndpoints(pool, viewer, { kind: "tier", ids: tierIds });
  for (const entry of entries) {
    for (const tier of entry.tiers) {
      tier.connection.endpoints = endpointsByTier.get(tier.tierId) ?? [];
    }
  }
  return entries;
}

/** What the admin review card shows beside a round's terms (section 1 row 6; design 6 item 1:
 * "the admin confirms a round without seeing the address it will copy", ruled a defect). */
export interface ProposalEndpointPreview {
  /** The round's rows, as the provider submitted them. */
  proposed: EndpointInput[];
  /** The live tier this round confirms into, by the same (application_id, tier_name) lookup
   * confirmProposalRound makes (provider-tier-proposals.ts:478-481), or null before the first
   * confirmation. */
  liveTierId: string | null;
  /** That tier's rows now. [] when there is no tier yet. */
  live: LiveEndpoint[];
  /** What confirm would write if it ran now: `proposed` with the verification carry computed
   * from `live` by the four-tuple (carryVerification). A claim about this page load: confirm
   * recomputes it from its own FOR UPDATE snapshot (replaceTierEndpoints), so a coxwell edit
   * to the live rows between this read and the confirm changes the outcome, not this preview. */
  afterConfirm: LiveEndpoint[];
}

/** Reads a round's endpoint rows and the rows of the tier it would replace, both through the
 * one reader with the caller's session. Read-only, no transaction: the two SELECTs may see
 * different instants, which is why afterConfirm is documented as a preview and not a promise.
 *
 * provider_tiers has no unique on (application_id, tier_name) (0060:29-30 are plain indexes;
 * fable's delta-2 plan ruling J3, m54043 via marcus m54049, logged as a follow-up, not built
 * here), so like confirm this
 * takes the first row the same predicate returns. Should two rows ever exist, the card and the
 * confirm could pick differently; that is the logged race, not a new one. */
export async function previewProposalEndpointsAdmin(
  viewer: EndpointViewer,
  round: { id: string; applicationId: string; tierName: string }
): Promise<ProposalEndpointPreview> {
  const proposed = (await readEndpoints(pool, viewer, { kind: "proposal", ids: [round.id] })).get(round.id) ?? [];

  const tierResult = await pool.query<{ id: string }>(
    `select id from provider_tiers where application_id = $1 and tier_name = $2`,
    [round.applicationId, round.tierName]
  );
  const liveTierId = tierResult.rows[0]?.id ?? null;
  const live =
    liveTierId === null
      ? []
      : ((await readEndpoints(pool, viewer, { kind: "tier", ids: [liveTierId] })).get(liveTierId) ?? []);

  return { proposed, liveTierId, live, afterConfirm: carryVerification(live, proposed) };
}

export interface RegisterTierInput {
  tierName: string;
  clientPriceCents: number;
  providerSplitPct: number;
  /** The tier's one endpoint row (position 0: protocol, host, port) or null for none, parsed by
   * the register-provider action through parseEndpointsJson (section 1 row 8, design 2.2
   * :178-179). Per-tier, typed on this tier's own inputs -- never copied from the application
   * fields, so a blank stays null and the roster keeps showing the application's value, marked
   * as such. No compid here on purpose (design 6 item 3, ruling (c): "compid stays absent
   * there, today's shape"): a live tier's compid is echoed back to the provider by the
   * blank-clear refusal in submitProposalRound (provider-tier-proposals.ts), so writing one from
   * this path needs marcus's say first (2026-09-23). The action builds the row from a draft
   * with no compid field, so it is null by construction, not by an override here. */
  endpoint: EndpointInput | null;
  /** The form's checkbox: becomes the position-0 row's endpoint_verified. */
  endpointVerified: boolean;
  regions: string[] | null;
  coverage: string[] | null;
}

export interface ApplicationFieldEdits {
  name: string;
  contactName: string | null;
  country: string | null;
  timezone: string | null;
  protocol: string | null;
  host: string | null;
  port: string | null;
  compid: string | null;
  coverage: string | null;
  regions: string | null;
  tiersOffered: string | null;
}

/** register-provider's final submit -- the "grant completes" step per Iris's Approve ->
 * register-provider contract (leo-feed-admin-split-2026-08-23): publishes one provider_tiers
 * row per tier and stamps onboarded_at in one transaction, so a crash mid-submit can't leave
 * the application reading Live with zero published tiers. Requires the application to already
 * be 'approved' with a linked user_id (set by approveProviderApplication) -- register-provider
 * only ever hydrates from an approved row, never re-keys the grant itself. */
export async function registerProviderTiers(
  applicationId: string,
  tiers: RegisterTierInput[],
  edits: ApplicationFieldEdits
): Promise<void> {
  if (tiers.length === 0) throw new Error("At least one tier is required to publish.");

  // A verified flag is a claim about this tier's specific host:port, not about the row
  // (provider-tier-endpoints.ts LiveEndpoint); with no row there is nothing it can be a claim
  // about, and the mirror would write endpoint_verified = false for the tier anyway (design 3
  // step 2, :205-206: zero rows -> all null and false). Refused rather than dropped silently,
  // because an admin ticked it and would otherwise get a success toast for a flag that did not
  // land. Today's INSERT wrote the tick with null host/port; that is not ported. Judgement call,
  // kai, delta 4: strike it if the tick should be dropped or accepted without an address.
  for (const tier of tiers) {
    if (tier.endpointVerified && tier.endpoint === null) {
      throw new Error(
        `Tier "${tier.tierName}": "Endpoint confirmed" is ticked but there is no endpoint to confirm. Enter host and port, or untick it.`
      );
    }
  }

  const application = await getProviderApplication(applicationId);
  if (!application) throw new Error("Provider application not found");
  if (application.status !== "approved") throw new Error("Application must be approved before registration");
  if (!application.userId) throw new Error("Application has no linked user account");

  const client = await pool.connect();
  try {
    await client.query("begin");

    await client.query(
      `update provider_applications
       set name = $2, contact_name = $3, country = $4, timezone = $5, protocol = $6,
           host = $7, port = $8, compid = $9, coverage = $10, regions = $11, tiers_offered = $12
       where id = $1`,
      [
        applicationId,
        edits.name,
        edits.contactName,
        edits.country,
        edits.timezone,
        edits.protocol,
        edits.host,
        edits.port,
        edits.compid,
        edits.coverage,
        edits.regions,
        edits.tiersOffered,
      ]
    );

    // The tier's endpoint is a child row at position 0 written by writeTierEndpoints, which also
    // mirrors it (four + endpoint_verified) onto the parent columns until 0092 (design 3 step 2,
    // :203-209; section 1 row 8, :44); the INSERT names none of the five. The writer wants the
    // provider_tiers row lock: this row is inserted in this transaction and is invisible to every
    // other transaction until commit, which is the same guarantee. A tier with no endpoint gets
    // zero child rows and an all-null, false mirror.
    for (const tier of tiers) {
      const inserted = await client.query<{ id: string }>(
        `insert into provider_tiers
           (application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
            regions, coverage)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          applicationId,
          application.userId,
          tier.tierName,
          tier.clientPriceCents,
          tier.providerSplitPct,
          tier.regions,
          tier.coverage,
        ]
      );
      await writeTierEndpoints(
        client,
        inserted.rows[0].id,
        tier.endpoint === null ? [] : [{ ...tier.endpoint, endpointVerified: tier.endpointVerified }]
      );
    }

    await client.query(`update provider_applications set onboarded_at = now() where id = $1`, [applicationId]);

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  const reloaded = await getProviderApplication(applicationId);
  if (reloaded) await notifyProviderLive(reloaded);
}
