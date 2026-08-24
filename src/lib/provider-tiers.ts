import { pool } from "./db";
import { getProviderApplication } from "./provider-applications";

export interface ProviderTierRow {
  id: string;
  applicationId: string;
  providerUserId: string;
  tierName: string;
  clientPriceCents: number;
  providerSplitPct: number;
  endpointHost: string | null;
  endpointPort: string | null;
  endpointVerified: boolean;
  publishedAt: Date;
}

interface Row {
  id: string;
  application_id: string;
  provider_user_id: string;
  tier_name: string;
  client_price_cents: number;
  provider_split_pct: number;
  endpoint_host: string | null;
  endpoint_port: string | null;
  endpoint_verified: boolean;
  published_at: Date;
}

function mapRow(row: Row): ProviderTierRow {
  return {
    id: row.id,
    applicationId: row.application_id,
    providerUserId: row.provider_user_id,
    tierName: row.tier_name,
    clientPriceCents: row.client_price_cents,
    providerSplitPct: row.provider_split_pct,
    endpointHost: row.endpoint_host,
    endpointPort: row.endpoint_port,
    endpointVerified: row.endpoint_verified,
    publishedAt: row.published_at,
  };
}

export async function listTiersForApplication(applicationId: string): Promise<ProviderTierRow[]> {
  const result = await pool.query<Row>(
    `select id, application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
            endpoint_host, endpoint_port, endpoint_verified, published_at
     from provider_tiers where application_id = $1 order by published_at`,
    [applicationId]
  );
  return result.rows.map(mapRow);
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
}
