"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";
import { softDeleteDownload } from "@/lib/downloads";
import { logAdminAction } from "@/lib/admin";
import { runAction, type ActionResult } from "@/lib/action-result";

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUsersPanelEmail(session.user.email)) throw new Error("forbidden");
  return session.user.id;
}

export async function deleteDownloadAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to delete build", async () => {
    const adminUserId = await requireAdmin();
    const id = formData.get("id") as string;
    await softDeleteDownload(id);
    await logAdminAction(adminUserId, "delete_download", null, { downloadId: id });

    revalidatePath("/admin/downloads");
    revalidatePath("/dashboard");
    revalidatePath("/downloads");
  });
}
