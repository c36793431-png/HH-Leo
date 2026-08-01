"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { verifyTelegramLogin, type TelegramLoginPayload } from "@/lib/telegram-auth";
import { claimPendingLicense, getLicenseForUser, computeLicenseDisplayStatus, getGroupTarget } from "@/lib/licenses";
import { sendPaidGroupInvite } from "@/lib/group-membership";
import type { ActionResult } from "@/lib/action-result";

const INVITE_RATE_LIMIT_MS = 60_000;

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

/** Self-serve "Start the bot" trigger — same sendPaidGroupInvite path the admin panel already
 * uses, gated behind a fresh server-side license/membership check so a paid user (or someone
 * spam-clicking) can't fetch an invite the client-rendered button state didn't actually earn them. */
export async function requestPaidGroupInviteAction(): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not authenticated." };
  const userId = session.user.id;

  const license = await getLicenseForUser(userId).catch(() => null);
  const displayStatus = computeLicenseDisplayStatus(license);
  if (displayStatus !== "active" && displayStatus !== "expiring") {
    return { ok: false, error: "Renew required — your license isn't active." };
  }

  const membership = await pool.query<{ status: string; invited_at: Date | null }>(
    `select status, invited_at from group_memberships where user_id = $1
     order by coalesce(joined_at, invited_at) desc limit 1`,
    [userId]
  );
  const latest = membership.rows[0];
  if (latest?.status === "joined") {
    return { ok: false, error: "You're already in the group." };
  }
  if (latest?.invited_at && Date.now() - latest.invited_at.getTime() < INVITE_RATE_LIMIT_MS) {
    return { ok: false, error: "Please wait a moment before requesting another invite." };
  }

  const target = await getGroupTarget(userId);
  if (!target) return { ok: false, error: "Account not found." };

  const result = await sendPaidGroupInvite(target);
  if (!result.sent) {
    return {
      ok: false,
      error:
        result.reason === "telegram_not_linked"
          ? "Link your Telegram account first."
          : "Failed to create your invite link. Try again shortly.",
    };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
