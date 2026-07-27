import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";
import { createDownload, PLATFORMS, type Platform } from "@/lib/downloads";
import { logAdminAction, resolveAdminUserId } from "@/lib/admin";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !isAdminUsersPanelEmail(session.user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const version = formData.get("version");
  const platform = formData.get("platform");
  const changelog = (formData.get("changelog") as string | null) || undefined;

  if (!(file instanceof File) || typeof version !== "string" || !version) {
    return NextResponse.json({ error: "file and version are required" }, { status: 400 });
  }
  if (typeof platform !== "string" || !PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json({ error: "platform must be windows or macos" }, { status: 400 });
  }

  const uploadedBy = await resolveAdminUserId(session.user.id);

  const download = await createDownload({
    file,
    version,
    platform: platform as Platform,
    changelog,
    uploadedBy,
  });

  await logAdminAction(uploadedBy, "upload_download", null, {
    downloadId: download.id,
    version,
    platform,
  });

  return NextResponse.json({
    id: download.id,
    version: download.version,
    sha256: download.sha256,
    size: download.sizeBytes,
    uploadedAt: download.uploadedAt.toISOString(),
  });
}
