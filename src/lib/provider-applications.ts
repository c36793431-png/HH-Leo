import { pool } from "./db";
import { notifyProviderApplicationSubmitted } from "./telemetry-sink";

export const PROVIDER_APPLICATION_STATUSES = ["pending", "approved", "declined"] as const;
export type ProviderApplicationStatus = (typeof PROVIDER_APPLICATION_STATUSES)[number];

export interface ProviderApplicationRow {
  id: string;
  userId: string | null;
  name: string;
  email: string;
  contactName: string | null;
  country: string | null;
  timezone: string | null;
  websiteUrl: string | null;
  protocol: string | null;
  host: string | null;
  port: string | null;
  compid: string | null;
  regions: string | null;
  coverage: string | null;
  tiersOffered: string | null;
  notes: string | null;
  status: ProviderApplicationStatus;
  appliedAt: Date;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  adminNotes: string | null;
  onboardedAt: Date | null;
}

interface Row {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  contact_name: string | null;
  country: string | null;
  timezone: string | null;
  website_url: string | null;
  protocol: string | null;
  host: string | null;
  port: string | null;
  compid: string | null;
  regions: string | null;
  coverage: string | null;
  tiers_offered: string | null;
  notes: string | null;
  status: string;
  applied_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  admin_notes: string | null;
  onboarded_at: Date | null;
}

function mapRow(row: Row): ProviderApplicationRow {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    contactName: row.contact_name,
    country: row.country,
    timezone: row.timezone,
    websiteUrl: row.website_url,
    protocol: row.protocol,
    host: row.host,
    port: row.port,
    compid: row.compid,
    regions: row.regions,
    coverage: row.coverage,
    tiersOffered: row.tiers_offered,
    notes: row.notes,
    status: row.status as ProviderApplicationStatus,
    appliedAt: row.applied_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    adminNotes: row.admin_notes,
    onboardedAt: row.onboarded_at,
  };
}

const SELECT_BASE = `
  select id, user_id, name, email, contact_name, country, timezone, website_url,
         protocol, host, port, compid, regions, coverage, tiers_offered, notes, status,
         applied_at, reviewed_at, reviewed_by, admin_notes, onboarded_at
  from provider_applications
`;

interface CreateArgs {
  name: string;
  email: string;
  contactName: string | null;
  country: string | null;
  timezone: string | null;
  websiteUrl: string | null;
  protocol: string | null;
  host: string | null;
  port: string | null;
  compid: string | null;
  regions: string | null;
  coverage: string | null;
  tiersOffered: string | null;
  notes: string | null;
  adminUrl: string;
}

/** Public /providers/apply intake -- no admin-approval-triggers-account-creation step is built
 * in this pass (see 0059's migration comment / feed-apply-spec.md's admin-side delta note), so
 * this only inserts the row and fires the admin notify, mirroring createPartnerApplication's
 * shape minus the user_id matching + approve/decline lifecycle that partner_applications has. */
export async function createProviderApplication(args: CreateArgs): Promise<ProviderApplicationRow> {
  const result = await pool.query<{ id: string }>(
    `insert into provider_applications
       (name, email, contact_name, country, timezone, website_url,
        protocol, host, port, compid, regions, coverage, tiers_offered, notes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     returning id`,
    [
      args.name,
      args.email,
      args.contactName,
      args.country,
      args.timezone,
      args.websiteUrl,
      args.protocol,
      args.host,
      args.port,
      args.compid,
      args.regions,
      args.coverage,
      args.tiersOffered,
      args.notes,
    ]
  );
  const row = await getProviderApplication(result.rows[0].id);
  if (!row) throw new Error("failed to load created provider application");

  await notifyProviderApplicationSubmitted({
    id: row.id,
    name: row.name,
    email: row.email,
    contactName: row.contactName,
    website: row.websiteUrl,
    coverage: row.coverage,
    tiersOffered: row.tiersOffered,
    notes: row.notes,
    adminUrl: args.adminUrl,
  }).catch(() => {});

  return row;
}

export async function getProviderApplication(id: string): Promise<ProviderApplicationRow | null> {
  const result = await pool.query<Row>(`${SELECT_BASE} where id = $1`, [id]);
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

export interface ListProviderApplicationsOptions {
  status?: ProviderApplicationStatus;
}

export async function listProviderApplications(
  options: ListProviderApplicationsOptions = {}
): Promise<ProviderApplicationRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    params.push(options.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await pool.query<Row>(`${SELECT_BASE} ${where} order by applied_at desc`, params);
  return result.rows.map(mapRow);
}

/** Approve = flip the applicant's user.role to 'feed_provider' + stamp the application row, in a
 * single transaction (mirrors approvePartnerApplication's account-linkage fallback: match an
 * existing user by user_id, else by email, else create one -- but as one atomic unit per the
 * admin-provider-applications-2026-08-23 spec, unlike the partner flow's sequential queries). */
export async function approveProviderApplication(id: string, actionedBy: string): Promise<ProviderApplicationRow> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const existing = await client.query<Row>(`${SELECT_BASE} where id = $1 for update`, [id]);
    if (!existing.rowCount) throw new Error("provider application not found");
    const application = mapRow(existing.rows[0]);

    let userId = application.userId;
    if (!userId) {
      const matched = await client.query<{ id: string }>(`select id from users where lower(email) = lower($1)`, [
        application.email,
      ]);
      userId = matched.rows[0]?.id ?? null;
    }
    if (userId) {
      await client.query(`update users set role = 'feed_provider', updated_at = now() where id = $1`, [userId]);
    } else {
      const created = await client.query<{ id: string }>(
        `insert into users (email, display_name, role) values ($1, $2, 'feed_provider') returning id`,
        [application.email, application.name]
      );
      userId = created.rows[0].id;
    }

    await client.query(
      `update provider_applications
       set status = 'approved', reviewed_at = now(), reviewed_by = $2, user_id = $3
       where id = $1`,
      [id, actionedBy, userId]
    );

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  const row = await getProviderApplication(id);
  if (!row) throw new Error("provider application not found after approval");
  return row;
}

export async function declineProviderApplication(
  id: string,
  actionedBy: string,
  adminNotes: string | null
): Promise<ProviderApplicationRow> {
  await pool.query(
    `update provider_applications
     set status = 'declined', reviewed_at = now(), reviewed_by = $2, admin_notes = $3
     where id = $1`,
    [id, actionedBy, adminNotes]
  );
  const row = await getProviderApplication(id);
  if (!row) throw new Error("provider application not found after decline");
  return row;
}
