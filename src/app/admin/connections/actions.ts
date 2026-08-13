"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { setMultipleIpsOk } from "@/lib/server-registration";

async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
}

export async function setMultipleIpsOkAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to update flag", async () => {
    await requireAdmin();
    const licenseId = formData.get("licenseId") as string;
    const value = formData.get("value") === "true";
    if (!licenseId) throw new Error("Missing license id");
    await setMultipleIpsOk(licenseId, value);
    revalidatePath("/admin/connections");
    revalidatePath(`/admin/connections/${licenseId}`);
  });
}
