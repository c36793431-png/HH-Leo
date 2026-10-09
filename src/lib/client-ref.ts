import { pool } from "./db";
import type { ClientRef } from "./telemetry-sink";

/** The client an admin alert names, read off users by id: email, telegram_username and the id
 * itself, so clientLine (telemetry-sink.ts) can fall back email -> @username -> id short (marcus
 * m62102 item 6). Its own read rather than a column added to the shared trial/request rows:
 * those rows reach the provider panel through maskIdentity (feed-providers.ts), which overwrites
 * named fields only, so a new identity field there would show the client to the provider.
 *
 * knownEmail is the email the caller already has (a licence claimed by email, say) and wins over
 * the row's. Never throws: an alert runs after its write has committed and must not fail it, so
 * a failed read still returns what the caller knew. */
export async function clientRefForUser(userId: string | null | undefined, knownEmail: string | null = null): Promise<ClientRef> {
  if (!userId) return { email: knownEmail, telegramUsername: null, userId: null };
  try {
    const result = await pool.query<{ email: string | null; telegram_username: string | null; telegram_user_id: string | null }>(
      `select email, telegram_username, telegram_user_id from users where id = $1`,
      [userId]
    );
    const row = result.rows[0];
    return {
      email: knownEmail ?? row?.email ?? null,
      telegramUsername: row?.telegram_username ?? null,
      userId,
      telegramUserId: row?.telegram_user_id != null ? String(row.telegram_user_id) : null,
    };
  } catch (err) {
    console.error("clientRefForUser: users lookup failed", err);
    return { email: knownEmail, telegramUsername: null, userId };
  }
}
