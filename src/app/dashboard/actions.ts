"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { verifyTelegramLogin, type TelegramLoginPayload } from "@/lib/telegram-auth";
import { claimPendingLicense } from "@/lib/licenses";

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
