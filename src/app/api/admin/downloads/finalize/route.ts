import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { del } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { finalizeDownloadUpload, isManualUploadPathname, PLATFORMS, SHA256_HEX, type Platform } from "@/lib/downloads";
import { pathnamesInUse } from "@/lib/publish-builds";
import { logAdminAction, resolveAdminUserId } from "@/lib/admin";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) {
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
    !SHA256_HEX.test(sha256) ||
    typeof sizeBytes !== "number" ||
    sizeBytes <= 0
  ) {
    return NextResponse.json({ ok: false, error: "missing or invalid upload metadata" }, { status: 400 });
  }
  if (typeof platform !== "string" || !PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json({ ok: false, error: "platform must be windows or macos" }, { status: 400 });
  }
  // Before the try: a refused pathname is never passed to the cleanup del().
  if (!isManualUploadPathname(platform as Platform, version, blobPathname)) {
    return NextResponse.json({ ok: false, error: "blobPathname is not this version's upload" }, { status: 400 });
  }
  // Same shape as confirm (Fable S1; marcus m66731): a pathname a live or draft row points at is
  // refused with no del, and the catch below deletes only a pathname no row points at.
  if ((await pathnamesInUse([blobPathname], { keptMaps: true })).size) {
    return NextResponse.json({ ok: false, error: "blobPathname belongs to a live or draft release" }, { status: 409 });
  }

  try {
    const uploadedBy = await resolveAdminUserId(session.user.id);

    const download = await finalizeDownloadUpload({
      blobUrl,
      blobPathname,
      version,
      platform: platform as Platform,
      changelog: typeof changelog === "string" && changelog ? changelog : undefined,
      sha256,
      sizeBytes,
      uploadedBy,
    });

    await logAdminAction(uploadedBy, "upload_download", null, {
      downloadId: download.id,
      version,
      platform,
    });

    revalidatePath("/admin/downloads");
    revalidatePath("/dashboard");
    revalidatePath("/downloads");

    return NextResponse.json({ ok: true, id: download.id });
  } catch (err) {
    // Re-checked now: a row may point at it since the check above. If the check fails, delete nothing.
    const inUse = await pathnamesInUse([blobPathname], { keptMaps: true }).catch(() => null);
    if (inUse && !inUse.size) await del(blobPathname).catch(() => undefined);
    const message = err instanceof Error ? err.message : "failed to finalize upload";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
