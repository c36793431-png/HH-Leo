"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { approvePartnerApplication, declinePartnerApplication } from "@/lib/partner-applications";

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
  return session.user.id;
}

export async function approvePartnerApplicationAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to approve application", async () => {
    const adminId = await requireAdmin();
    const id = formData.get("id") as string;
    const adminNotes = ((formData.get("adminNotes") as string) ?? "").trim() || null;
    await approvePartnerApplication(id, adminId, adminNotes);
    revalidatePath("/admin/partner-applications");
  });
}

export async function declinePartnerApplicationAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to decline application", async () => {
    const adminId = await requireAdmin();
    const id = formData.get("id") as string;
    const adminNotes = ((formData.get("adminNotes") as string) ?? "").trim() || null;
    await declinePartnerApplication(id, adminId, adminNotes);
    revalidatePath("/admin/partner-applications");
  });
}
