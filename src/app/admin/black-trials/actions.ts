"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { approveBlackTrial, declineBlackTrial } from "@/lib/black-trials";

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
  return session.user.id;
}

export async function approveBlackTrialAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction("Failed to approve Black trial", async () => {
    const adminId = await requireAdmin();
    const id = formData.get("id") as string;
    const endpoint = ((formData.get("endpoint") as string) ?? "").trim();
    const credentials = ((formData.get("credentials") as string) ?? "").trim();
    const trialDays = Number(formData.get("trialDays") ?? 7);
    if (!endpoint) throw new Error("Endpoint is required");
    if (!credentials) throw new Error("Credentials are required");
    if (!Number.isFinite(trialDays) || trialDays <= 0) throw new Error("Invalid trial length");

    await approveBlackTrial({ id, actionedBy: adminId, endpoint, credentials, trialDays });
    revalidatePath("/admin/black-trials");
  });
}

export async function declineBlackTrialAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction("Failed to decline Black trial", async () => {
    const adminId = await requireAdmin();
    const id = formData.get("id") as string;
    const reason = ((formData.get("reason") as string) ?? "").trim() || null;
    await declineBlackTrial(id, adminId, reason);
    revalidatePath("/admin/black-trials");
  });
}
