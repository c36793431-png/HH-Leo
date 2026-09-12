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

/** Keyed on the server row's id now, not its licence. licenseId still comes along, but
 * only to revalidate the detail route -- /admin/connections/[licenseId] is still addressed
 * by licence, and re-keying that route is B-1's job, not this slice's. No owner clause on
 * the write: requireAdmin() above is the gate, and an admin acting on another user's
 * server is the purpose of this surface. */
export async function setMultipleIpsOkAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to update flag", async () => {
    await requireAdmin();
    const registrationId = formData.get("registrationId") as string;
    const licenseId = formData.get("licenseId") as string;
    const value = formData.get("value") === "true";
    if (!registrationId) throw new Error("No server registration on this licence yet");
    const updated = await setMultipleIpsOk(registrationId, value);
    if (!updated) throw new Error("Server registration not found");
    revalidatePath("/admin/connections");
    if (licenseId) revalidatePath(`/admin/connections/${licenseId}`);
  });
}
