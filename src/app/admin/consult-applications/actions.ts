"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { approveConsultantApplication, declineConsultantApplication } from "@/lib/consultant-applications";

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
  return session.user.id;
}

export async function approveConsultantApplicationAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to approve application", async () => {
    const adminId = await requireAdmin();
    await approveConsultantApplication(String(formData.get("id") ?? ""), adminId);
    revalidatePath("/admin/consult-applications");
  });
}

export async function declineConsultantApplicationAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to decline application", async () => {
    const adminId = await requireAdmin();
    await declineConsultantApplication(String(formData.get("id") ?? ""), adminId, String(formData.get("note") ?? ""));
    revalidatePath("/admin/consult-applications");
  });
}
