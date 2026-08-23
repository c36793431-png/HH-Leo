"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { approveProviderApplication, declineProviderApplication } from "@/lib/provider-applications";

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
  return session.user.id;
}

export async function approveProviderApplicationAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to approve application", async () => {
    const adminId = await requireAdmin();
    const id = formData.get("id") as string;
    await approveProviderApplication(id, adminId);
    revalidatePath("/admin/provider-applications");
  });
}

export async function declineProviderApplicationAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to reject application", async () => {
    const adminId = await requireAdmin();
    const id = formData.get("id") as string;
    await declineProviderApplication(id, adminId);
    revalidatePath("/admin/provider-applications");
  });
}
