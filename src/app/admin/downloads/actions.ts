"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";
import { createDownload, softDeleteDownload, PLATFORMS, type Platform } from "@/lib/downloads";
import { logAdminAction } from "@/lib/admin";

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUsersPanelEmail(session.user.email)) throw new Error("forbidden");
  return session.user.id;
}

export async function uploadDownloadAction(formData: FormData) {
  const adminUserId = await requireAdmin();
  const file = formData.get("file");
  const version = formData.get("version");
  const platform = formData.get("platform");
  const changelog = (formData.get("changelog") as string | null) || undefined;

  if (!(file instanceof File) || typeof version !== "string" || !version) {
    throw new Error("file and version are required");
  }
  if (typeof platform !== "string" || !PLATFORMS.includes(platform as Platform)) {
    throw new Error("platform must be windows or macos");
  }

  const download = await createDownload({
    file,
    version,
    platform: platform as Platform,
    changelog,
    uploadedBy: adminUserId,
  });

  await logAdminAction(adminUserId, "upload_download", null, {
    downloadId: download.id,
    version,
    platform,
  });

  revalidatePath("/admin/downloads");
  revalidatePath("/dashboard");
  revalidatePath("/downloads");
}

export async function deleteDownloadAction(formData: FormData) {
  const adminUserId = await requireAdmin();
  const id = formData.get("id") as string;
  await softDeleteDownload(id);
  await logAdminAction(adminUserId, "delete_download", null, { downloadId: id });

  revalidatePath("/admin/downloads");
  revalidatePath("/dashboard");
  revalidatePath("/downloads");
}
