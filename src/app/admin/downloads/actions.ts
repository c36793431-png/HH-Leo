"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { softDeleteDownload, updateDownloadMetadata } from "@/lib/downloads";
import { logAdminAction } from "@/lib/admin";
import { runAction, type ActionResult } from "@/lib/action-result";

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
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

export async function updateDownloadAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to update build", async () => {
    const adminUserId = await requireAdmin();
    const id = formData.get("id") as string;
    const version = (formData.get("version") as string)?.trim();
    const changelog = formData.get("changelog") as string;
    if (!version) throw new Error("Version is required");

    await updateDownloadMetadata(id, { version, changelog });
    await logAdminAction(adminUserId, "update_download", null, { downloadId: id, version });

    revalidatePath("/admin/downloads");
    revalidatePath("/dashboard");
    revalidatePath("/downloads");
  });
}
