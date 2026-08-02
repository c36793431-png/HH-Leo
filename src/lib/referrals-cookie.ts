import { cookies } from "next/headers";
import { pool } from "./db";
import { REFERRAL_COOKIE } from "./referrals";

/**
 * Split out of referrals.ts on 2026-08-02 to unblock the production build.
 *
 * referrals.ts is imported by licenses.ts, which is imported by a client
 * component (admin/feed-select-form.tsx) and, via lib/auth.ts, by the
 * middleware entry (proxy.ts). `next/headers` is Server-Component-only, so
 * once that chain closed the whole build failed with:
 *   ./src/lib/referrals.ts:2:1  You're importing a module that depends on
 *   "next/headers" ... but you are using it in the Pages Router.
 * Keeping the single cookie-dependent function here means referrals.ts stays
 * safe to import from anywhere. Only call this from a Server Component or a
 * server action.
 */
/** Resolves the hz_ref cookie (if any) to a referrer and attributes the new user to them.
 * Only ever applies on first creation (guarded by `referred_by_user_id is null`) and blocks
 * self-referral defensively, though a brand-new user can't yet know their own code. Call once,
 * right after a users row is inserted, from every signup path (Telegram inline insert + the
 * Auth.js adapter's createUser event for the email path). */
export async function attributeReferralFromCookie(newUserId: string): Promise<void> {
  const store = await cookies();
  const code = store.get(REFERRAL_COOKIE)?.value;
  if (!code) return;

  const referrer = await pool.query<{ id: string }>(
    "select id from users where referral_code = $1",
    [code.trim()]
  );
  const referrerId = referrer.rows[0]?.id;
  if (!referrerId || referrerId === newUserId) return;

  await pool.query(
    `update users set referred_by_user_id = $1, referred_at = now()
     where id = $2 and referred_by_user_id is null`,
    [referrerId, newUserId]
  );
}
