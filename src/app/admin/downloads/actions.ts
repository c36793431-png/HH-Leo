"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { publishDownload, softDeleteDownload, unpublishDownload, updateDownloadMetadata } from "@/lib/downloads";
import { logAdminAction, resolveAdminUserId } from "@/lib/admin";
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

/** The only way a draft goes live: an admin session, never PUBLISH_API_TOKEN (marcus m66684).
 * The GO behind the click names version + sha256 from the uploader's banked build log, compared by
 * eye with the row's Draft pill (Fable S3). */
export async function publishDownloadAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to publish build", async () => {
    const adminUserId = await requireAdmin();
    const id = formData.get("id") as string;
    const publishedBy = await resolveAdminUserId(adminUserId);
    const row = await publishDownload(id, publishedBy);
    await logAdminAction(adminUserId, "publish_download", null, {
      downloadId: id,
      version: row.version,
      platform: row.platform,
      sha256: row.sha256,
    });

    revalidatePath("/admin/downloads");
    revalidatePath("/dashboard");
    revalidatePath("/downloads");
  });
}

/** Live -> draft, keeping the blob: the previous published version is latest again at once. */
export async function unpublishDownloadAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to unpublish build", async () => {
    const adminUserId = await requireAdmin();
    const id = formData.get("id") as string;
    const row = await unpublishDownload(id);
    await logAdminAction(adminUserId, "unpublish_download", null, {
      downloadId: id,
      version: row.version,
      platform: row.platform,
      sha256: row.sha256,
    });

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
