import { pool } from "./db";
import { notifyPartnerApplicationSubmitted } from "./telemetry-sink";
import { sendHftAlertMessage } from "./telegram-hft-alert-bot";
import { sendEmail } from "./email";

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

export async function approvePartnerApplication(
  id: string,
  actionedBy: string,
  adminNotes: string | null
): Promise<PartnerApplicationRow> {
  const row = await actionApplication(id, "approved", actionedBy, adminNotes);

  // No matching account yet is a known, expected outcome (applicant applied before ever
  // signing up) -- not an error. Just record the approval; there's no user row to promote
  // to role='partner' until they create an account and re-match, which isn't automated here.
  if (row.userId) {
    await pool.query(`update users set role = 'partner', updated_at = now() where id = $1`, [row.userId]);
  }

  await notifyApplicant(
    row,
    "Your Horizon HFT partner application was approved",
    `<b>✅ Partner application approved</b>\nWelcome aboard -- ${
      row.userId
        ? "your account now has partner access, log in at partner.horizonhft.com."
        : "create a Horizon HFT account with this email, then log in at partner.horizonhft.com to get partner access."
    }`
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
