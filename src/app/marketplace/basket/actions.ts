"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { basketReference, createBasketRequest } from "@/lib/basket-requests";
import type { BasketLine } from "@/lib/basket-catalogue";
import { clientReachForUser } from "@/lib/client-reach";
import { getBotUsername } from "@/lib/telegram-bot";

/** What the Sent step needs to say how we'll answer (marcus m61849 part 3). botStartUrl opens the portal bot so a
 * Telegram-only client with no working channel can turn notifications on. */
export type SubmitReach = { reachable: boolean; hasEmail: boolean; needsBotStart: boolean; botStartUrl: string | null };

export type SubmitBasketResult =
  | { ok: true; reference: string; lines: BasketLine[]; hasTrial: boolean; reach: SubmitReach }
  | { ok: false; error: string };

/**
 * Send the basket as ONE request (marcus m59146). Signed-in accounts only; admins don't request.
 * The lines and the trial are both re-checked in createBasketRequest, so nothing the client
 * sends is trusted: Black, Alpha and Ultra are refused even when the POST skips the button.
 * Writes one basket_requests row and grants nothing.
 */
export async function submitBasketAction(input: {
  lines: unknown;
  wantTrial: boolean;
}): Promise<SubmitBasketResult> {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new Error("Sign in to send your request");
    if (isAdminUser(session.user)) throw new Error("Admin accounts don't send basket requests");
    const created = await createBasketRequest({
      userId: session.user.id,
      lines: input?.lines,
      wantTrial: input?.wantTrial === true,
    });
    revalidatePath("/marketplace/requests");
    const reach = await clientReachForUser(session.user.id).catch(() => ({ reachable: false, hasEmail: false, needsBotStart: true }));
    const bot = reach.needsBotStart ? await getBotUsername().catch(() => null) : null;
    return {
      ok: true,
      reference: basketReference(created.id),
      lines: created.lines,
      hasTrial: input?.wantTrial === true,
      reach: { ...reach, botStartUrl: bot ? `https://t.me/${bot}?start=notify` : null },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.message ? err.message : "Failed to send your request" };
  }
}
