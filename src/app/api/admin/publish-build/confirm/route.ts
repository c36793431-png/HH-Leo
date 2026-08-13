import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { PLATFORMS, type Platform, confirmPublishedBuild } from "@/lib/publish-builds";
import { logAdminAction, resolveServiceAccountUserId } from "@/lib/admin";

function authorized(req: NextRequest): boolean {
  const secret = process.env.PUBLISH_API_TOKEN;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Phase 2 of the CI auto-publish flow: Actions calls this after both PUTs (build zip +
 * mapping.txt) land in Blob. Re-hashes the uploaded build server-side and rejects if it
 * doesn't match the sha256 declared in phase 1 — a stronger integrity check than the
 * manual admin form gets, since no human is eyeballing this write path. A failed confirm
 * (hash mismatch or a version already published by a concurrent run) leaves no Versions
 * row and deletes both blobs, so customers never see a half-published state.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const version = body?.version;
  const platform = body?.platform;
  const changelog = body?.changelog;
  const buildBlobUrl = body?.buildBlobUrl;
  const buildBlobPathname = body?.buildBlobPathname;
  const mappingBlobUrl = body?.mappingBlobUrl;
  const mappingBlobPathname = body?.mappingBlobPathname;
  const sha256 = body?.sha256;
  const sizeBytes = body?.sizeBytes;

  if (
    typeof version !== "string" ||
    !version ||
    typeof buildBlobUrl !== "string" ||
    !buildBlobUrl ||
    typeof buildBlobPathname !== "string" ||
    !buildBlobPathname ||
    typeof mappingBlobUrl !== "string" ||
    !mappingBlobUrl ||
    typeof mappingBlobPathname !== "string" ||
    !mappingBlobPathname ||
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
    const publishedBy = await resolveServiceAccountUserId();

    const download = await confirmPublishedBuild({
      version,
      platform: platform as Platform,
      changelog: typeof changelog === "string" && changelog ? changelog : undefined,
      buildBlobUrl,
      buildBlobPathname,
      mappingBlobUrl,
      mappingBlobPathname,
      declaredSha256: sha256,
      declaredSizeBytes: sizeBytes,
      publishedBy,
    });

    await logAdminAction(publishedBy, "publish_build_ci", null, {
      downloadId: download.id,
      version,
      platform,
    });

    revalidatePath("/admin/downloads");
    revalidatePath("/dashboard");
    revalidatePath("/downloads");

    return NextResponse.json({ ok: true, id: download.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to confirm publish";
    const alreadyPublished = message.includes("already published");
    return NextResponse.json({ ok: false, error: message }, { status: alreadyPublished ? 409 : 422 });
  }
}
