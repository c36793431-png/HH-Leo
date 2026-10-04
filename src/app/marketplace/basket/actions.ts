"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { basketReference, createBasketRequest } from "@/lib/basket-requests";
import type { BasketLine } from "@/lib/basket-catalogue";

export type SubmitBasketResult =
  | { ok: true; reference: string; lines: BasketLine[]; hasTrial: boolean }
  | { ok: false; error: string };

/**
 * Send the basket as ONE request (marcus m59146). Signed-in accounts only; admins don't request.
 * The lines, the trial and the Telegram field are all re-checked in createBasketRequest, so
 * nothing the client sends is trusted: Black, Alpha and Ultra are refused even when the POST
 * skips the button. Writes one basket_requests row and grants nothing.
 */
export async function submitBasketAction(input: {
  lines: unknown;
  wantTrial: boolean;
  telegramHandle?: string | null;
}): Promise<SubmitBasketResult> {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new Error("Sign in to send your request");
    if (isAdminUser(session.user)) throw new Error("Admin accounts don't send basket requests");
    const created = await createBasketRequest({
      userId: session.user.id,
      lines: input?.lines,
      wantTrial: input?.wantTrial === true,
      telegramHandle: typeof input?.telegramHandle === "string" ? input.telegramHandle : null,
    });
    revalidatePath("/marketplace/requests");
    return { ok: true, reference: basketReference(created.id), lines: created.lines, hasTrial: input?.wantTrial === true };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.message ? err.message : "Failed to send your request" };
  }
}
