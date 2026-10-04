"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { logAdminAction, resolveAdminUserId } from "@/lib/admin";
import { setBasketRequestHandled } from "@/lib/basket-requests";

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
