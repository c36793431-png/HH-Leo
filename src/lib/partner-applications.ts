import { pool } from "./db";
import { notifyPartnerApplicationSubmitted } from "./telemetry-sink";
import { sendHftAlertMessage } from "./telegram-hft-alert-bot";
import { sendEmail } from "./email";
import { createPartner, getPartnerByUserId } from "./partners";
import { resolveAdminUserId } from "./admin";

export const PARTNER_APPLICATION_STATUSES = ["pending", "approved", "declined"] as const;
export type PartnerApplicationStatus = (typeof PARTNER_APPLICATION_STATUSES)[number];

export interface PartnerApplicationRow {
  id: string;
  userId: string | null;
  name: string;
  email: string;
  telegram: string | null;
  notes: string | null;
  status: PartnerApplicationStatus;
  appliedAt: Date;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  adminNotes: string | null;
  telegramUserId: string | null;
}

interface Row {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  telegram: string | null;
  notes: string | null;
  status: string;
  applied_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  admin_notes: string | null;
  telegram_user_id: string | null;
}

function mapRow(row: Row): PartnerApplicationRow {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    telegram: row.telegram,
    notes: row.notes,
    status: row.status as PartnerApplicationStatus,
    appliedAt: row.applied_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    adminNotes: row.admin_notes,
    telegramUserId: row.telegram_user_id,
  };
}

const SELECT_BASE = `
  select pa.id, pa.user_id, pa.name, pa.email, pa.telegram, pa.notes, pa.status,
         pa.applied_at, pa.reviewed_at, pa.reviewed_by, pa.admin_notes, u.telegram_user_id
  from partner_applications pa
  left join users u on u.id = pa.user_id
`;

interface CreateArgs {
  name: string;
  email: string;
  telegram: string | null;
  notes: string | null;
  adminUrl: string;
}

export async function createPartnerApplication(args: CreateArgs): Promise<PartnerApplicationRow> {
  const matchedUser = await pool.query<{ id: string }>(
    `select id from users where lower(email) = lower($1)`,
    [args.email]
  );
  const userId = matchedUser.rows[0]?.id ?? null;

  const result = await pool.query<{ id: string }>(
    `insert into partner_applications (user_id, name, email, telegram, notes)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [userId, args.name, args.email, args.telegram, args.notes]
  );
  const row = await getPartnerApplication(result.rows[0].id);
  if (!row) throw new Error("failed to load created partner application");

  await notifyPartnerApplicationSubmitted({
    id: row.id,
    name: row.name,
    email: row.email,
    telegram: row.telegram,
    notes: row.notes,
    adminUrl: args.adminUrl,
  }).catch(() => {});

  return row;
}

export async function getPartnerApplication(id: string): Promise<PartnerApplicationRow | null> {
  const result = await pool.query<Row>(`${SELECT_BASE} where pa.id = $1`, [id]);
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

/** Looks up the most recent pending application for a signed-in user, matched by user_id
 * first (set at apply-time if the email matched an existing account) and falling back to a
 * case-insensitive email match for the (more common) case of someone applying before they
 * ever created a portal account. Used by the partner dashboard login gate. */
export async function getPendingPartnerApplicationForUser(
  userId: string,
  email: string | null
): Promise<PartnerApplicationRow | null> {
  const result = await pool.query<Row>(
    `${SELECT_BASE} where pa.status = 'pending' and (pa.user_id = $1 or lower(pa.email) = lower($2))
     order by pa.applied_at desc limit 1`,
    [userId, email ?? ""]
  );
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

export interface ListPartnerApplicationsOptions {
  status?: PartnerApplicationStatus;
}

export async function listPartnerApplications(
  options: ListPartnerApplicationsOptions = {}
): Promise<PartnerApplicationRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    params.push(options.status);
    conditions.push(`pa.status = $${params.length}`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await pool.query<Row>(`${SELECT_BASE} ${where} order by pa.applied_at desc`, params);
  return result.rows.map(mapRow);
}

/** Best-effort DM/email notify to the applicant -- a failed send must never fail the
 * approve/decline action itself, same pattern as feed-tier-requests.ts's notifyClient. */
async function notifyApplicant(row: PartnerApplicationRow, subject: string, text: string): Promise<void> {
  if (row.telegramUserId) {
    await sendHftAlertMessage(row.telegramUserId, text).catch(() => {});
  }
  await sendEmail(row.email, subject, text.replace(/<\/?b>/g, "")).catch(() => {});
}

async function actionApplication(
  id: string,
  status: "approved" | "declined",
  actionedBy: string,
  adminNotes: string | null
): Promise<PartnerApplicationRow> {
  await pool.query(
    `update partner_applications
     set status = $2, reviewed_at = now(), reviewed_by = $3, admin_notes = $4
     where id = $1`,
    [id, status, actionedBy, adminNotes]
  );
  const row = await getPartnerApplication(id);
  if (!row) throw new Error("partner application not found after update");
  return row;
}

/** Mirrors provider-applications.ts's linkOrCreateProviderUser: users.role is overwritten only
 * when the current role is 'user' -- an existing admin/partner/feed_provider role is left alone
 * (promotion-only, never lateral or downgrade, per user-roles-migration-2026-09-01). The grant
 * is always recorded in user_roles regardless, so a second role never disappears even when
 * users.role can't show it. Runs as one transaction so the read-then-write can't race another
 * conversion of the same user. */
async function recordPartnerRoleConversion(userId: string, actionedBy: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const previous = await client.query<{ role: string }>(`select role from users where id = $1`, [userId]);
    const previousRole = previous.rows[0]?.role ?? null;
    const nextRole = previousRole === "user" ? "partner" : previousRole;
    if (previousRole === "user") {
      await client.query(`update users set role = 'partner', updated_at = now() where id = $1`, [userId]);
    }
    const resolvedAdminUserId = await resolveAdminUserId(actionedBy);
    await client.query(
      `insert into user_roles (user_id, role, granted_by) values ($1, 'partner', $2)
       on conflict (user_id, role) do nothing`,
      [userId, resolvedAdminUserId]
    );
    await client.query(
      `insert into admin_actions (admin_user_id, action_type, target_user_id, details_json)
       values ($1, $2, $3, $4)`,
      [
        resolvedAdminUserId,
        "partner_role_conversion",
        userId,
        JSON.stringify({ from: previousRole, to: nextRole, granted_role: "partner" }),
      ]
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function approvePartnerApplication(
  id: string,
  actionedBy: string,
  adminNotes: string | null
): Promise<PartnerApplicationRow> {
  let row = await actionApplication(id, "approved", actionedBy, adminNotes);

  if (row.userId) {
    await recordPartnerRoleConversion(row.userId, actionedBy);
  } else {
    // Hybrid account-linkage (leo-partner-page-broken-auth-buttons-2026-08-22): re-check
    // for an account created between apply-time and approve-time before creating a new
    // one, to avoid forking a duplicate row against the same email (users.email is unique).
    const matched = await pool.query<{ id: string }>(`select id from users where lower(email) = lower($1)`, [
      row.email,
    ]);
    let userId = matched.rows[0]?.id ?? null;
    if (userId) {
      await recordPartnerRoleConversion(userId, actionedBy);
    } else {
      const created = await pool.query<{ id: string }>(
        `insert into users (email, display_name, role) values ($1, $2, 'partner') returning id`,
        [row.email, row.name]
      );
      userId = created.rows[0].id;
      const resolvedAdminUserId = await resolveAdminUserId(actionedBy);
      await pool.query(
        `insert into user_roles (user_id, role, granted_by) values ($1, 'partner', $2)
         on conflict (user_id, role) do nothing`,
        [userId, resolvedAdminUserId]
      );
    }
    await pool.query(`update partner_applications set user_id = $2 where id = $1`, [row.id, userId]);
    const reloaded = await getPartnerApplication(row.id);
    if (!reloaded) throw new Error("partner application not found after user linkage");
    row = reloaded;
  }

  // Seed the deal-tracking `partners` row so /partner/dashboard has something to render --
  // self-serve approval only flipped users.role above, which grants access but leaves the
  // dashboard's "No partner record is linked" empty state showing (leo-partner-page-broken-
  // auth-buttons-2026-08-22). Deals/commission split are set later, per-payment, by
  // recordAutoPartnerPayment's DEFAULT_PARTNER_PCT/DEFAULT_COXWELL_PCT (60/40) -- there's no
  // tier field on `partners` itself to default here.
  if (row.userId && !(await getPartnerByUserId(row.userId))) {
    await createPartner({ name: row.name, email: row.email, userId: row.userId });
  }

  await notifyApplicant(
    row,
    "Your Horizon HFT partner application was approved",
    `<b>✅ Partner application approved</b>\nWelcome aboard -- your account now has partner access. ` +
      `Log in at partner.horizonhft.com using this email address (${row.email}) and choose ` +
      `"Sign in with email" to get a one-time link -- no password needed.`
  );

  return row;
}

export async function declinePartnerApplication(
  id: string,
  actionedBy: string,
  adminNotes: string | null
): Promise<PartnerApplicationRow> {
  const row = await actionApplication(id, "declined", actionedBy, adminNotes);

  await notifyApplicant(
    row,
    "Your Horizon HFT partner application",
    `<b>❌ Partner application declined</b>\nYour partner application wasn't approved this time.` +
      (adminNotes ? `\nReason: ${adminNotes}` : "")
  );

  return row;
}
