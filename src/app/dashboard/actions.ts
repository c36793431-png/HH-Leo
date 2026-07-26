"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { verifyTelegramLogin, type TelegramLoginPayload } from "@/lib/telegram-auth";
import { claimPendingLicense, extendLicense, revokeLicense } from "@/lib/licenses";
import { logAdminAction } from "@/lib/admin";

/**
 * Hardcoded gate for coxwell's own license lifecycle test buttons (bus thread
 * horizon-portal-license-status-widget-2026-07-26). Not a real admin role check —
 * replace with a proper role/permission once more than one person needs this.
 */
const SELF_TEST_USER_ID = "94529d89-ae75-4df5-a15f-1f8a004509d1";

async function requireOwnLicense(licenseId: string): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.id !== SELF_TEST_USER_ID) throw new Error("forbidden");
  const result = await pool.query<{ id: string }>(
    "select id from licenses where id = $1 and user_id = $2",
    [licenseId, session.user.id]
  );
  if (!result.rows[0]) throw new Error("license not found for this user");
  return session.user.id;
}

export async function selfExpireNowAction(formData: FormData) {
  const licenseId = formData.get("licenseId") as string;
  const userId = await requireOwnLicense(licenseId);
  await pool.query("update licenses set expires_at = now() where id = $1", [licenseId]);
  await logAdminAction(userId, "self_test_expire_now", userId, { licenseId });
  revalidatePath("/dashboard");
}

export async function selfExtend30Action(formData: FormData) {
  const licenseId = formData.get("licenseId") as string;
  const userId = await requireOwnLicense(licenseId);
  await extendLicense(licenseId, 30);
  await logAdminAction(userId, "self_test_extend_30d", userId, { licenseId });
  revalidatePath("/dashboard");
}

export async function selfRevokeAction(formData: FormData) {
  const licenseId = formData.get("licenseId") as string;
  const userId = await requireOwnLicense(licenseId);
  await revokeLicense(licenseId);
  await logAdminAction(userId, "self_test_revoke", userId, { licenseId });
  revalidatePath("/dashboard");
}

/** Attaches telegram_user_id to the current session's user — the "Link Telegram" flow from account convergence. */
export async function linkTelegramAction(payload: TelegramLoginPayload): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const botToken = process.env.HORIZON_PORTAL_BOT_TOKEN;
  if (!botToken) throw new Error("Telegram bot not configured");
  if (!verifyTelegramLogin(payload, botToken)) throw new Error("Invalid Telegram signature");

  const existing = await pool.query<{ id: string }>(
    "select id from users where telegram_user_id = $1",
    [payload.id]
  );
  if (existing.rows[0] && existing.rows[0].id !== session.user.id) {
    throw new Error("This Telegram account is already linked to another user");
  }

  const displayNameFallback =
    [payload.first_name, payload.last_name].filter(Boolean).join(" ") ||
    payload.username ||
    `tg_${payload.id}`;

  await pool.query(
    `update users
     set telegram_user_id = $1, telegram_username = $2,
         display_name = coalesce(display_name, $3), updated_at = now()
     where id = $4`,
    [payload.id, payload.username ?? null, displayNameFallback, session.user.id]
  );

  await claimPendingLicense({ userId: session.user.id, telegramUserId: payload.id });

  revalidatePath("/dashboard");
}
