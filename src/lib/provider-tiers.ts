import { pool } from "./db";
import { getProviderApplication, notifyProviderLive } from "./provider-applications";

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

/** Connection details as captured on provider_tiers -- PER TIER. protocol/compid are text and
 * regions/coverage are text[] (0083), matching provider_tier_proposals, so these arrive already
 * structured and need no parsing. Populated only by confirmProposalRound's copy-forward
 * (3f96166/d25c250/849b383); the manual register-provider path still writes none of the four
 * 0083 columns, so hand-registered tiers read null here by design and fall back to the
 * application grain at render time. */
export interface TierConnectionDetails {
  protocol: string | null;
  compid: string | null;
  endpointHost: string | null;
  endpointPort: string | null;
  /** A claim about this tier's specific endpoint_host:endpoint_port, not about the row -- so it
   * must never be shown against an endpoint sourced from anywhere else. */
  endpointVerified: boolean;
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
 * in the return type so the caller has to state which one it is rendering. */
export async function listProviderRoster(): Promise<ProviderRosterEntry[]> {
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
    tier_name: string | null;
    client_price_cents: number | null;
    provider_split_pct: number | null;
    tier_protocol: string | null;
    tier_compid: string | null;
    endpoint_host: string | null;
    endpoint_port: string | null;
    endpoint_verified: boolean | null;
    tier_regions: string[] | null;
    tier_coverage: string[] | null;
  }>(
    `select pa.id as application_id, pa.name as provider_name, pa.onboarded_at, pa.source,
            u.display_name as reviewer_display_name, u.email as reviewer_email,
            pa.protocol as app_protocol, pa.host as app_host, pa.port as app_port,
            pa.compid as app_compid, pa.regions as app_regions, pa.coverage as app_coverage,
            t.tier_name, t.client_price_cents, t.provider_split_pct,
            t.protocol as tier_protocol, t.compid as tier_compid,
            t.endpoint_host, t.endpoint_port, t.endpoint_verified,
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
    if (row.tier_name != null && row.client_price_cents != null && row.provider_split_pct != null) {
      entry.tiers.push({
        tierName: row.tier_name,
        clientPriceCents: row.client_price_cents,
        providerSplitPct: row.provider_split_pct,
        connection: {
          protocol: row.tier_protocol,
          compid: row.tier_compid,
          endpointHost: row.endpoint_host,
          endpointPort: row.endpoint_port,
          // provider_tiers.endpoint_verified is `not null default false` (0060:25); it only
          // arrives null from a left-join miss, which this branch has already excluded.
          endpointVerified: row.endpoint_verified ?? false,
          regions: row.tier_regions ?? [],
          coverage: row.tier_coverage ?? [],
        },
      });
    }
  }
  return Array.from(byApplication.values());
}

export interface RegisterTierInput {
  tierName: string;
  clientPriceCents: number;
  providerSplitPct: number;
  endpointHost: string | null;
  endpointPort: string | null;
  endpointVerified: boolean;
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

    for (const tier of tiers) {
      await client.query(
        `insert into provider_tiers
           (application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
            endpoint_host, endpoint_port, endpoint_verified)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          applicationId,
          application.userId,
          tier.tierName,
          tier.clientPriceCents,
          tier.providerSplitPct,
          tier.endpointHost,
          tier.endpointPort,
          tier.endpointVerified,
        ]
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
