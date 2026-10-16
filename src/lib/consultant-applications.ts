import { pool } from "./db";
import { notifyConsultantApplicationSubmitted } from "./telemetry-sink";
import { sendEmail } from "./email";
import { resolveAdminUserId } from "./admin";
import { PORTAL_ORIGIN } from "./feed-host-admin";

/**
 * Consult supply side S1a: consultant applications (0112; marcus m68993, rulings m69004, answers m69029; scope kai
 * m69020, Fable PASS WITH STRIKES m69076 S1-S5).
 *
 * Public apply, no sign-in. An application grants nothing: no account is created and there is no consultant role
 * (ruling 3). An approved row is the permission later slices read. Approve and decline are one transaction each,
 * with the row locked and a pending guard, and write an admin_actions row. Applicant mail goes after the commit.
 *
 * Not copied from partner/provider applications: account creation at approve, the unguarded update with no audit,
 * the receipt email to whatever address was typed (a relay, Fable m69076 ask 2) and rows[0] on an email match
 * (Fable m69076 ask 3).
 */

export const CONSULTANT_APPLICATION_STATUSES = ["pending", "approved", "declined"] as const;
export type ConsultantApplicationStatus = (typeof CONSULTANT_APPLICATION_STATUSES)[number];

/** The 0112 CHECK limits. The form and the action use the same numbers. */
export const CONSULTANT_APPLICATION_LIMITS = {
  name: 120,
  email: 254,
  telegramMin: 2,
  telegram: 64,
  expertise: 1000,
  background: 2000,
  profileUrl: 300,
  declinedNote: 1000,
} as const;

export const CONSULT_APPLICATIONS_ADMIN_URL = `${PORTAL_ORIGIN}/admin/consult-applications`;

export interface ConsultantApplicationRow {
  id: string;
  userId: string | null;
  userEmail: string | null;
  name: string;
  email: string;
  telegram: string | null;
  expertise: string;
  background: string | null;
  profileUrl: string | null;
  status: ConsultantApplicationStatus;
  decidedByEmail: string | null;
  decidedAt: Date | null;
  declinedNote: string | null;
  createdAt: Date;
}

const SELECT_BASE = `
  select ca.id, ca.user_id, u.email as user_email, ca.name, ca.email, ca.telegram, ca.expertise, ca.background,
         ca.profile_url, ca.status, du.email as decided_by_email, ca.decided_at, ca.declined_note, ca.created_at
  from consultant_applications ca
  left join users u on u.id = ca.user_id
  left join users du on du.id = ca.decided_by
`;

function mapRow(row: Record<string, unknown>): ConsultantApplicationRow {
  return {
    id: row.id as string,
    userId: (row.user_id as string | null) ?? null,
    userEmail: (row.user_email as string | null) ?? null,
    name: row.name as string,
    email: row.email as string,
    telegram: (row.telegram as string | null) ?? null,
    expertise: row.expertise as string,
    background: (row.background as string | null) ?? null,
    profileUrl: (row.profile_url as string | null) ?? null,
    status: row.status as ConsultantApplicationStatus,
    decidedByEmail: (row.decided_by_email as string | null) ?? null,
    decidedAt: (row.decided_at as Date | null) ?? null,
    declinedNote: (row.declined_note as string | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

/** http(s) only, the same test as 0112's profile_url CHECK (Fable S2). The admin page links a URL only if it passes. */
export function isSafeProfileUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export class ConsultantApplicationError extends Error {}

export interface ConsultantApplicationInput {
  name: string;
  email: string;
  telegram: string | null;
  expertise: string;
  background: string | null;
  profileUrl: string | null;
}

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** The form's fields, checked against the 0112 limits. Throws ConsultantApplicationError with the message the
 * applicant sees. The email is stored lower(trim()) (Fable S1). */
export function parseConsultantApplication(formData: FormData): ConsultantApplicationInput {
  const L = CONSULTANT_APPLICATION_LIMITS;
  const name = field(formData, "name");
  const email = field(formData, "email").toLowerCase();
  const telegram = field(formData, "telegram") || null;
  const expertise = field(formData, "expertise");
  const background = field(formData, "background") || null;
  const profileUrl = field(formData, "profileUrl") || null;

  if (!name || name.length > L.name) throw new ConsultantApplicationError(`Name is required, up to ${L.name} characters`);
  if (email.length < 3 || email.length > L.email || email.indexOf("@") < 1) throw new ConsultantApplicationError("A valid email is required");
  if (telegram && (telegram.length < L.telegramMin || telegram.length > L.telegram)) {
    throw new ConsultantApplicationError(`Telegram must be ${L.telegramMin} to ${L.telegram} characters`);
  }
  if (!expertise || expertise.length > L.expertise) throw new ConsultantApplicationError(`Expertise is required, up to ${L.expertise} characters`);
  if (background && background.length > L.background) throw new ConsultantApplicationError(`Background is up to ${L.background} characters`);
  if (profileUrl && (profileUrl.length > L.profileUrl || !isSafeProfileUrl(profileUrl))) {
    throw new ConsultantApplicationError(`Profile link must start with http:// or https://, up to ${L.profileUrl} characters`);
  }
  return { name, email, telegram, expertise, background, profileUrl };
}

const PG_UNIQUE_VIOLATION = "23505";

/** Stores one application and sends the one approvals-topic card (text only; buttons are S1b). No user_id: an
 * unverified submission links to no account (Fable m69076 ask 3). No receipt email (ask 2). */
export async function createConsultantApplication(input: ConsultantApplicationInput): Promise<{ id: string }> {
  let id: string;
  try {
    const result = await pool.query(
      `insert into consultant_applications (name, email, telegram, expertise, background, profile_url)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [input.name, input.email, input.telegram, input.expertise, input.background, input.profileUrl]
    );
    id = result.rows[0].id;
  } catch (err) {
    if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      throw new ConsultantApplicationError("An application for this email is already in review or approved");
    }
    throw err;
  }

  await notifyConsultantApplicationSubmitted({
    name: input.name,
    email: input.email,
    telegram: input.telegram,
    expertise: input.expertise,
    adminUrl: CONSULT_APPLICATIONS_ADMIN_URL,
  }).catch(() => {});

  return { id };
}

/** The public form's whole server path. A filled honeypot ("website", careers/actions.ts:14-19) returns as if it
 * succeeded and writes and sends nothing. */
export async function submitConsultantApplicationForm(formData: FormData): Promise<void> {
  if (field(formData, "website") !== "") return;
  await createConsultantApplication(parseConsultantApplication(formData));
}

export async function getConsultantApplication(id: string): Promise<ConsultantApplicationRow | null> {
  const result = await pool.query(`${SELECT_BASE} where ca.id = $1`, [id]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

/** Newest first; all statuses when none is given. */
export async function listConsultantApplications(options: { status?: ConsultantApplicationStatus } = {}): Promise<ConsultantApplicationRow[]> {
  const params: unknown[] = [];
  let where = "";
  if (options.status) {
    params.push(options.status);
    where = `where ca.status = $1`;
  }
  const result = await pool.query(`${SELECT_BASE} ${where} order by ca.created_at desc, ca.id`, params);
  return result.rows.map(mapRow);
}

/** Applicant mail (m69029 a: plain, short, no prices, no promises of work). Wording signed off by marcus m69102,
 * approved mail amended there. The decline text is generic and never carries declined_note (Fable S3, p3 D2.2). */
export function consultantApprovedEmail(name: string): { subject: string; text: string } {
  return {
    subject: "Your Horizon HFT consultant application",
    text:
      `Hi ${name},\n\n` +
      `Thank you for applying to consult with Horizon HFT. Your application has been approved.\n\n` +
      `We will be in touch shortly about the next steps.\n\n` +
      `Horizon HFT`,
  };
}

export function consultantDeclinedEmail(name: string): { subject: string; text: string } {
  return {
    subject: "Your Horizon HFT consultant application",
    text:
      `Hi ${name},\n\n` +
      `Thank you for applying to consult with Horizon HFT. We are not able to approve your application at this time.\n\n` +
      `Horizon HFT`,
  };
}

type Decision = { status: "approved" } | { status: "declined"; note: string };

/** One transaction: lock the row, refuse anything not pending, stamp the decision, write the audit row. Approve
 * also links user_id by an exact match on the stored (normalised) email: none -> NULL, more than one -> refuse
 * (Fable m69076 ask 3). Returns the row as committed. */
async function decide(id: string, actionedBy: string, decision: Decision): Promise<{ name: string; email: string; userId: string | null }> {
  const adminId = await resolveAdminUserId(actionedBy);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const locked = await client.query(
      `select id, name, email, status, user_id from consultant_applications where id = $1 for update`,
      [id]
    );
    const row = locked.rows[0];
    if (!row) throw new ConsultantApplicationError("Consultant application not found");
    if (row.status !== "pending") throw new ConsultantApplicationError(`This application is already ${row.status}`);

    let userId: string | null = row.user_id ?? null;
    if (decision.status === "approved") {
      const matches = await client.query(`select id from users where lower(email) = $1`, [row.email]);
      if (matches.rows.length > 1) {
        throw new ConsultantApplicationError(`${matches.rows.length} accounts share this email, merge in /admin/users first`);
      }
      userId = matches.rows[0]?.id ?? null;
      await client.query(
        `update consultant_applications
         set status = 'approved', decided_by = $2, decided_at = now(), user_id = $3
         where id = $1`,
        [id, adminId, userId]
      );
    } else {
      await client.query(
        `update consultant_applications
         set status = 'declined', decided_by = $2, decided_at = now(), declined_note = $3
         where id = $1`,
        [id, adminId, decision.note]
      );
    }
    await client.query(
      `insert into admin_actions (admin_user_id, action_type, target_user_id, details_json)
       values ($1, $2, $3, $4)`,
      [
        adminId,
        decision.status === "approved" ? "consultant_application_approved" : "consultant_application_declined",
        userId,
        JSON.stringify({ consultantApplicationId: id, email: row.email }),
      ]
    );
    await client.query("commit");
    return { name: row.name, email: row.email, userId };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function approveConsultantApplication(id: string, actionedBy: string): Promise<void> {
  const row = await decide(id, actionedBy, { status: "approved" });
  // After the commit: a Resend failure can't undo or fail a committed decision (Fable S3, partner-applications.ts:149).
  const mail = consultantApprovedEmail(row.name);
  await sendEmail(row.email, mail.subject, mail.text).catch(() => {});
}

/** The note is required (p3 D2.2) and private: it goes on the row for admins, never to the applicant. */
export async function declineConsultantApplication(id: string, actionedBy: string, note: string): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) throw new ConsultantApplicationError("A note is required to decline");
  if (trimmed.length > CONSULTANT_APPLICATION_LIMITS.declinedNote) {
    throw new ConsultantApplicationError(`The note is up to ${CONSULTANT_APPLICATION_LIMITS.declinedNote} characters`);
  }
  const row = await decide(id, actionedBy, { status: "declined", note: trimmed });
  const mail = consultantDeclinedEmail(row.name);
  await sendEmail(row.email, mail.subject, mail.text).catch(() => {});
}
