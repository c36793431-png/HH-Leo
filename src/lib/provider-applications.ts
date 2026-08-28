import type { PoolClient } from "@neondatabase/serverless";
import { pool } from "./db";
import { notifyProviderApplicationSubmitted } from "./telemetry-sink";
import { sendEmail } from "./email";
import { resolveAdminUserId } from "./admin";

const FEED_HOST = "feed.horizonhft.com";

/** Best-effort applicant email -- a failed send must never fail the caller's action,
 * same pattern as partner-applications.ts's notifyApplicant. */
function notifyApplicantEmail(email: string, subject: string, text: string): Promise<void> {
  return sendEmail(email, subject, text, { replyTo: process.env.SUPPORT_EMAIL }).catch(() => {});
}

export const PROVIDER_APPLICATION_STATUSES = ["pending", "approved", "declined"] as const;
export type ProviderApplicationStatus = (typeof PROVIDER_APPLICATION_STATUSES)[number];

export const PROVIDER_APPLICATION_SOURCES = ["application", "admin_manual"] as const;
export type ProviderApplicationSource = (typeof PROVIDER_APPLICATION_SOURCES)[number];

export interface ProviderApplicationRow {
  id: string;
  userId: string | null;
  source: ProviderApplicationSource;
  referenceId: string;
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
  source: string;
  reference_id: string;
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
    source: row.source as ProviderApplicationSource,
    referenceId: row.reference_id,
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
  select id, user_id, source, reference_id, name, email, contact_name, country, timezone, website_url,
         protocol, host, port, compid, regions, coverage, tiers_offered, notes, status,
         applied_at, reviewed_at, reviewed_by, admin_notes, onboarded_at
  from provider_applications
`;

/** Tidies free-text protocol entry without rejecting anything unrecognized (Iris's ruling,
 * feed-admin-provider-applications-rebuild-2026-08-25): "fix4.4"/"fix 4.4"/"FIX4.4" all collapse
 * to "FIX 4.4" so the admin queue doesn't fragment into near-duplicate chips, but an exotic
 * protocol string a provider actually types still gets through untouched (just trimmed). */
function normalizeProtocol(raw: string): string | null {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed) return null;
  const match = collapsed.match(/^([A-Za-z]+)\s*(\d[\d.]*)?$/);
  if (!match) return collapsed;
  const [, word, version] = match;
  return version ? `${word.toUpperCase()} ${version}` : word.toUpperCase();
}

/** Normalizes the region list's separator to " · " regardless of whether the provider typed
 * commas, spaces, or an existing middot -- multi-value is allowed per the spec ("LD4 · NY4" or
 * "LD4, NY4"), this just makes the stored form consistent so the card can split it into pills. */
function normalizeRegions(raw: string): string | null {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed) return null;
  const parts = collapsed
    .split(/[,·]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

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
  const protocol = args.protocol ? normalizeProtocol(args.protocol) : null;
  const regions = args.regions ? normalizeRegions(args.regions) : null;
  const year = new Date().getFullYear();
  let insertedId: string | null = null;
  // Collision retry, not a lookup loop: reference_id is unique, and a random 4-digit clash
  // within the same year is rare but possible at low volume -- retry a few times rather than
  // failing the applicant's submission over it.
  for (let attempt = 0; attempt < 5 && !insertedId; attempt++) {
    const referenceId = `FP-${year}-${Math.floor(1000 + Math.random() * 9000)}`;
    try {
      const result = await pool.query<{ id: string }>(
        `insert into provider_applications
           (reference_id, name, email, contact_name, country, timezone, website_url,
            protocol, host, port, compid, regions, coverage, tiers_offered, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         returning id`,
        [
          referenceId,
          args.name,
          args.email,
          args.contactName,
          args.country,
          args.timezone,
          args.websiteUrl,
          protocol,
          args.host,
          args.port,
          args.compid,
          regions,
          args.coverage,
          args.tiersOffered,
          args.notes,
        ]
      );
      insertedId = result.rows[0].id;
    } catch (err) {
      const isUniqueViolation = err instanceof Error && "code" in err && (err as { code?: string }).code === "23505";
      if (!isUniqueViolation) throw err;
    }
  }
  if (!insertedId) throw new Error("failed to allocate a unique provider application reference id");

  const row = await getProviderApplication(insertedId);
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

  await notifyApplicantEmail(
    row.email,
    "We received your Horizon feed provider application",
    `Thanks for applying to become a Horizon HFT feed provider.\n\n` +
      `We've received your application for ${row.name} and it's in review. We'll follow up at this ` +
      `address once a decision is made -- no action is needed from you in the meantime.`
  );

  return row;
}

/** Deterministic small-int hash -- used only to pick a stable avatar color per row. */
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/** The persisted reference_id, same string shown to the applicant at submit and stored on the
 * row (0067_provider_application_reference_id) -- no longer a derivation, just a field read. */
export function providerApplicationReferenceId(a: Pick<ProviderApplicationRow, "referenceId">): string {
  return a.referenceId;
}

export function providerApplicationAvatarSeed(name: string): number {
  return Math.abs(hashCode(name));
}

export async function getProviderApplication(id: string): Promise<ProviderApplicationRow | null> {
  const result = await pool.query<Row>(`${SELECT_BASE} where id = $1`, [id]);
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

export interface ListProviderApplicationsOptions {
  status?: ProviderApplicationStatus;
  search?: string;
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
  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(`(name ilike $${params.length} or email ilike $${params.length} or reference_id ilike $${params.length})`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await pool.query<Row>(`${SELECT_BASE} ${where} order by applied_at desc`, params);
  return result.rows.map(mapRow);
}

export interface ProviderApplicationStats {
  pendingCount: number;
  approvedCount: number;
  declinedCount: number;
}

export async function getProviderApplicationStats(): Promise<ProviderApplicationStats> {
  const result = await pool.query<{ status: string; count: string }>(
    `select status, count(*) as count from provider_applications group by status`
  );
  const byStatus = new Map(result.rows.map((r) => [r.status, Number(r.count)]));
  return {
    pendingCount: byStatus.get("pending") ?? 0,
    approvedCount: byStatus.get("approved") ?? 0,
    declinedCount: byStatus.get("declined") ?? 0,
  };
}

/** Shared by approveProviderApplication and createManualProviderApplication: match an existing
 * user by id (if already linked) or email, else create one with role 'feed_provider'. Must run
 * inside the caller's transaction (takes the connected client, not the pool). */
/** Overwriting an existing user's role destroys any record of what it was before --
 * there is no multi-role model, so a matched account (e.g. a former admin applying
 * as a provider) would otherwise lose that fact for good. Mirrors the audit trail
 * admin/users/actions.ts's updateUserFieldAction already writes for manual role edits,
 * so both role-changing paths land in the same admin_actions table. */
async function linkOrCreateProviderUser(
  client: PoolClient,
  email: string,
  name: string,
  existingUserId: string | null,
  actionedBy: string
): Promise<string> {
  let userId = existingUserId;
  if (!userId) {
    const matched = await client.query<{ id: string }>(`select id from users where lower(email) = lower($1)`, [
      email,
    ]);
    userId = matched.rows[0]?.id ?? null;
  }
  if (userId) {
    const previous = await client.query<{ role: string }>(`select role from users where id = $1`, [userId]);
    const previousRole = previous.rows[0]?.role ?? null;
    await client.query(`update users set role = 'feed_provider', updated_at = now() where id = $1`, [userId]);
    const resolvedAdminUserId = await resolveAdminUserId(actionedBy);
    await client.query(
      `insert into admin_actions (admin_user_id, action_type, target_user_id, details_json)
       values ($1, $2, $3, $4)`,
      [
        resolvedAdminUserId,
        "provider_role_conversion",
        userId,
        JSON.stringify({ from: previousRole, to: "feed_provider" }),
      ]
    );
  } else {
    const created = await client.query<{ id: string }>(
      `insert into users (email, display_name, role) values ($1, $2, 'feed_provider') returning id`,
      [email, name]
    );
    userId = created.rows[0].id;
  }
  return userId;
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

    const userId = await linkOrCreateProviderUser(
      client,
      application.email,
      application.name,
      application.userId,
      actionedBy
    );

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

/** Admin-initiated direct onboarding (register-provider's manual mode, no public application on
 * file -- e.g. a Black-tier partner coxwell recruits offline). Creates the provider_applications
 * row already 'approved' with source='admin_manual', so it can flow into registerProviderTiers
 * exactly like a pre-filled application. Per Iris's spec (iris-register-provider-manual-mode-
 * 2026-08-24): same account-linkage rule as approve, just triggered at creation instead of at
 * approval of a pre-existing pending row. */
export async function createManualProviderApplication(
  args: { name: string; email: string },
  actionedBy: string
): Promise<ProviderApplicationRow> {
  const client = await pool.connect();
  let id: string;
  try {
    await client.query("begin");

    const userId = await linkOrCreateProviderUser(client, args.email, args.name, null, actionedBy);

    const referenceId = `FP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const inserted = await client.query<{ id: string }>(
      `insert into provider_applications
         (reference_id, name, email, status, source, user_id, applied_at, reviewed_at, reviewed_by)
       values ($1, $2, $3, 'approved', 'admin_manual', $4, now(), now(), $5)
       returning id`,
      [referenceId, args.name, args.email, userId, actionedBy]
    );
    id = inserted.rows[0].id;

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  const row = await getProviderApplication(id);
  if (!row) throw new Error("provider application not found after manual creation");
  return row;
}

/** Fired once registerProviderTiers has published at least one tier -- approval alone only
 * grants the 'feed_provider' role, the dashboard has nothing to show until tiers exist, so the
 * "you're live" email waits for that step rather than firing at approve time (leo-provider-
 * onboarding-notification-gap-2026-08-24). Best-effort, never throws. */
export async function notifyProviderLive(row: ProviderApplicationRow): Promise<void> {
  await notifyApplicantEmail(
    row.email,
    "You're approved as a Horizon feed provider",
    `Your Horizon HFT feed provider application for ${row.name} has been approved and your feed ` +
      `tier is now live.\n\n` +
      `Log in at ${FEED_HOST} using this email address (${row.email}) and choose "Sign in with ` +
      `email" -- we'll send you a one-time link, no password needed.\n\n` +
      `Once signed in you'll land on your provider dashboard.`
  );
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
