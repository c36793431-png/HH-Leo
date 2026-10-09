import { sendTelegramMessage } from "./telegram-bot";
import { sendEmail } from "./email";
import { pool } from "./db";

interface Recipient {
  /** When given, the Telegram attempt's result is recorded on the user (tg_last_dm_*), so admin pages and the
   * client's own "turn on notifications" prompt can say whether Telegram actually reaches them. */
  userId?: string | null;
  telegramUserId?: string | number | null;
  email?: string | null;
}

/** One channel notifyUser tried, and what it answered. */
export type NotifyAttempt =
  | { channel: "telegram"; ok: true; telegramMessageId: number | null }
  | { channel: "email"; ok: true; resendEmailId: string | null }
  | { channel: "telegram" | "email"; ok: false; error: string };

/** What one notifyUser call did. Delivered = the channel that worked. Not delivered = channel "none" with
 * unreachable: true and every attempt's reason; the caller must handle it (client-reach.reportUnreachable for
 * grants). attempts is absent only on outcomes built by callers (a thrown send, a missing users row). */
export type NotifyOutcome =
  | { channel: "telegram"; ok: true; telegramMessageId: number | null; attempts?: NotifyAttempt[] }
  | { channel: "email"; ok: true; resendEmailId: string | null; attempts?: NotifyAttempt[] }
  | { channel: "telegram" | "email"; ok: false; error: string; unreachable?: true; attempts?: NotifyAttempt[] }
  | { channel: "none"; ok: false; error: string; unreachable?: true; attempts?: NotifyAttempt[] };

const errName = (err: unknown) => `threw ${err instanceof Error ? err.name : typeof err}`;

/** Email is sent as plain text: a message written for Telegram's HTML mode (e.g. the Black trial's "<b>…</b>")
 * loses its tags and entities there, so the email fallback doesn't show raw markup. */
const plainText = (s: string) =>
  s.replace(/<\/?(?:b|strong|i|em|u|s|code|pre)>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Records the Telegram attempt on the user. Best-effort: a failed write never changes the delivery. */
async function recordTelegramResult(userId: string, attempt: NotifyAttempt): Promise<void> {
  await pool
    .query(`update users set tg_last_dm_at = now(), tg_last_dm_ok = $2, tg_last_dm_error = $3 where id = $1`, [
      userId,
      attempt.ok,
      attempt.ok ? null : attempt.error.slice(0, 300),
    ])
    .catch((err) => console.error("notify: tg_last_dm record failed", userId, err instanceof Error ? err.message : err));
}

/** Telegram DM if we have a telegram_user_id, then email if Telegram failed or is absent (coxwell 10-06 via
 * marcus m61849/m61876: never fail silently). Telegram is tried whether or not the user pressed Start: a
 * Telegram login with write access can receive DMs without it (telegram-login-button.tsx). Never throws, except
 * a Telegram throw when the caller asks for it (opts.propagateTelegramThrow: the licence-key send). */
export async function notifyUser(
  recipient: Recipient,
  subject: string,
  message: string,
  /** propagateTelegramThrow: a Telegram THROW (network, missing token; not a refusal) is recorded on the user and
   * re-thrown instead of falling back. Only the licence-key send uses it: its callers (the agent API's reconcile)
   * already handle that throw. A refusal (non-2xx, e.g. 403) still falls back to email. */
  opts: { propagateTelegramThrow?: boolean } = {}
): Promise<NotifyOutcome> {
  const attempts: NotifyAttempt[] = [];

  if (recipient.telegramUserId) {
    let attempt: NotifyAttempt;
    try {
      const r = await sendTelegramMessage(recipient.telegramUserId, message);
      attempt = r.ok ? { channel: "telegram", ok: true, telegramMessageId: r.messageId } : { channel: "telegram", ok: false, error: r.error };
    } catch (err) {
      attempt = { channel: "telegram", ok: false, error: errName(err) };
      if (opts.propagateTelegramThrow) {
        if (recipient.userId) await recordTelegramResult(recipient.userId, attempt);
        throw err;
      }
    }
    attempts.push(attempt);
    if (recipient.userId) await recordTelegramResult(recipient.userId, attempt);
    if (attempt.ok) return { channel: "telegram", ok: true, telegramMessageId: attempt.telegramMessageId, attempts };
  }

  if (recipient.email) {
    let attempt: NotifyAttempt;
    try {
      const r = await sendEmail(recipient.email, subject, plainText(message));
      attempt = r.ok ? { channel: "email", ok: true, resendEmailId: r.emailId } : { channel: "email", ok: false, error: r.error };
    } catch (err) {
      attempt = { channel: "email", ok: false, error: errName(err) };
    }
    attempts.push(attempt);
    if (attempt.ok) return { channel: "email", ok: true, resendEmailId: attempt.resendEmailId, attempts };
  }

  // One channel tried and failed: keep its shape (channel + its raw error), as before this change.
  if (attempts.length === 1 && !attempts[0].ok) return { ...attempts[0], unreachable: true, attempts } as NotifyOutcome;
  const error = attempts.length
    ? attempts.map((a) => `${a.channel}: ${a.ok ? "ok" : a.error}`).join("; ")
    : "no telegram_user_id and no email";
  return { channel: "none", ok: false, unreachable: true, error, attempts };
}
