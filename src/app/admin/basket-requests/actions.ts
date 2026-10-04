"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { logAdminAction, resolveAdminUserId } from "@/lib/admin";
import { getBasketRequest, setBasketRequestHandled } from "@/lib/basket-requests";
import { forwardBasketFeedLines, type ForwardLineResult } from "@/lib/basket-forward";

export type ForwardBasketState = { ok: true; results: ForwardLineResult[] } | { ok: false; error: string } | null;

/** "Forward feed lines to providers" (marcus m59987). Writes only through
 * createAccessRequestBatch (lib/basket-forward.ts); returns each line's result for the screen.
 * The basket row itself is not changed: Handled stays the admin's own click. */
export async function forwardBasketFeedLinesAction(_prev: ForwardBasketState, formData: FormData): Promise<ForwardBasketState> {
  try {
    const session = await auth();
    if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
    const id = String(formData.get("id") ?? "");
    const request = await getBasketRequest(id);
    if (!request) throw new Error("Basket request not found");
    const picks: Record<string, string[]> = {};
    for (const line of request.lines) {
      if (line.kind === "feed") picks[line.key] = formData.getAll(`pick:${line.key}`).map(String);
    }
    const results = await forwardBasketFeedLines({ userId: request.userId, lines: request.lines, picks });
    const adminId = await resolveAdminUserId(session.user.id);
    if (results.some((r) => r.outcome === "forwarded")) {
      await logAdminAction(adminId, "basket_feed_lines_forwarded", request.userId, {
        basketRequestId: id,
        results: results.map((r) => ({ key: r.key, server: r.server, outcome: r.outcome })),
      });
    }
    revalidatePath("/admin/basket-requests");
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.message ? err.message : "Failed to forward" };
  }
}

/** Mark a basket request handled, or back to new. Bookkeeping only: it grants nothing and
 * nothing reads it to grant (marcus m59146). Logged to admin_actions like every admin write. */
export async function setBasketRequestHandledAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
  const id = String(formData.get("id") ?? "");
  const handled = formData.get("handled") === "1";
  const adminId = await resolveAdminUserId(session.user.id);
  const changed = await setBasketRequestHandled(id, adminId, handled);
  if (changed) {
    await logAdminAction(adminId, handled ? "basket_request_handled" : "basket_request_reopened", changed.userId, { basketRequestId: id });
  }
  revalidatePath("/admin/basket-requests");
}
