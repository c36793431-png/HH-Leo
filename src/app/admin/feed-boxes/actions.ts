"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { logAdminAction } from "@/lib/admin";
import { runAction, type ActionResult } from "@/lib/action-result";
import { createFeedBox, issueBoxToken } from "@/lib/feed-boxes";

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
  return session.user.id;
}

export async function createFeedBoxAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction("Failed to create the box", async () => {
    const adminId = await requireAdmin();
    const name = String(formData.get("name") ?? "").trim();
    const tiers = formData.getAll("tier").map(String).filter(Boolean);
    await createFeedBox(name, tiers);
    await logAdminAction(adminId, "feed_box_created", null, { box: name, tiers }).catch(() => {});
    revalidatePath("/admin/feed-boxes");
  });
}

export type IssueTokenResult = { ok: true; name: string; token: string } | { ok: false; error: string } | null;

/** Issue or rotate a box's token (marcus m62718: admin only, shown once, never stored in plaintext or logged). The
 * audit row names the box and nothing else; the token goes back to this one response and nowhere else. */
export async function issueBoxTokenAction(_prev: IssueTokenResult, formData: FormData): Promise<IssueTokenResult> {
  try {
    const adminId = await requireAdmin();
    const boxId = String(formData.get("boxId") ?? "");
    if (!/^[0-9a-f-]{36}$/.test(boxId)) return { ok: false, error: "No box" };
    const { name, token } = await issueBoxToken(boxId);
    await logAdminAction(adminId, "feed_box_token_rotated", null, { box: name }).catch(() => {});
    revalidatePath("/admin/feed-boxes");
    return { ok: true, name, token };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.message ? err.message : "Failed to issue the token" };
  }
}
