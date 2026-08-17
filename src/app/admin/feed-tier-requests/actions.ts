"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { approveFeedTierRequest, rejectFeedTierRequest } from "@/lib/feed-tier-requests";

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
  return session.user.id;
}

export async function approveFeedTierRequestAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to approve request", async () => {
    const adminId = await requireAdmin();
    const id = formData.get("id") as string;
    await approveFeedTierRequest(id, adminId, "/admin/feed-tier-trials");
    revalidatePath("/admin/feed-tier-requests");
  });
}

export async function rejectFeedTierRequestAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to reject request", async () => {
    const adminId = await requireAdmin();
    const id = formData.get("id") as string;
    const reason = ((formData.get("reason") as string) ?? "").trim() || null;
    await rejectFeedTierRequest(id, adminId, reason);
    revalidatePath("/admin/feed-tier-requests");
  });
}
