import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";
import { finalizeDownloadUpload, PLATFORMS, type Platform } from "@/lib/downloads";
import { logAdminAction } from "@/lib/admin";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !isAdminUsersPanelEmail(session.user.email)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const blobUrl = body?.blobUrl;
  const blobPathname = body?.blobPathname;
  const version = body?.version;
  const platform = body?.platform;
  const changelog = body?.changelog;
  const sha256 = body?.sha256;
  const sizeBytes = body?.sizeBytes;

  if (
    typeof blobUrl !== "string" ||
    !blobUrl ||
    typeof blobPathname !== "string" ||
    !blobPathname ||
    typeof version !== "string" ||
    !version ||
    typeof sha256 !== "string" ||
    sha256.length !== 64 ||
    typeof sizeBytes !== "number" ||
    sizeBytes <= 0
  ) {
    return NextResponse.json({ ok: false, error: "missing or invalid upload metadata" }, { status: 400 });
  }
  if (typeof platform !== "string" || !PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json({ ok: false, error: "platform must be windows or macos" }, { status: 400 });
  }

  try {
    const download = await finalizeDownloadUpload({
      blobUrl,
      blobPathname,
      version,
      platform: platform as Platform,
      changelog: typeof changelog === "string" && changelog ? changelog : undefined,
      sha256,
      sizeBytes,
      uploadedBy: session.user.id,
    });

    await logAdminAction(session.user.id, "upload_download", null, {
      downloadId: download.id,
      version,
      platform,
    });

    revalidatePath("/admin/downloads");
    revalidatePath("/dashboard");
    revalidatePath("/downloads");

    return NextResponse.json({ ok: true, id: download.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to finalize upload";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
