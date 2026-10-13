import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  PLATFORMS,
  SHA256_HEX,
  VERSION_PATTERN,
  DEFAULT_BUILD_FILENAME,
  PublishRefusedError,
  type Platform,
  confirmPublishedBuild,
  isBuildFilename,
  isPublishBearer,
} from "@/lib/publish-builds";
import { logAdminAction, resolveServiceAccountUserId } from "@/lib/admin";

// Re-hashing a ~52 MB zip streams it through this function (Leo m66654 §1, Fable (f)). The
// uploader treats a 504 as unknown state and re-checks via phase 1 (409 = the row landed).
export const maxDuration = 60;

/**
 * Phase 2 of the agent/CI upload flow: the uploader calls this after both PUTs (build zip +
 * Mapping.txt) land in Blob. Records a DRAFT only — no field here can publish; an admin publishes
 * from /admin/downloads. The server computes both Blob pathnames itself, re-hashes both blobs and
 * refuses on any mismatch with what the uploader declared. A refused confirm leaves no row and
 * deletes this upload's own blobs, never one a release points at.
 */
export async function POST(req: NextRequest) {
  if (!isPublishBearer(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const version = body?.version;
  const platform = body?.platform;
  const filename = body?.filename === undefined ? DEFAULT_BUILD_FILENAME : body.filename;
  const changelog = body?.changelog;
  const sha256 = body?.sha256;
  const sizeBytes = body?.sizeBytes;
  const mappingSha256 = body?.mappingSha256;
  const mappingSizeBytes = body?.mappingSizeBytes;

  if (
    typeof version !== "string" ||
    !VERSION_PATTERN.test(version) ||
    !isBuildFilename(filename) ||
    typeof sha256 !== "string" ||
    !SHA256_HEX.test(sha256) ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    typeof mappingSha256 !== "string" ||
    !SHA256_HEX.test(mappingSha256) ||
    !Number.isSafeInteger(mappingSizeBytes) ||
    mappingSizeBytes <= 0
  ) {
    return NextResponse.json({ ok: false, error: "missing or invalid upload metadata" }, { status: 400 });
  }
  if (typeof platform !== "string" || !PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json({ ok: false, error: "platform must be windows or macos" }, { status: 400 });
  }

  try {
    const uploadedBy = await resolveServiceAccountUserId();

    const download = await confirmPublishedBuild({
      version,
      platform: platform as Platform,
      filename,
      changelog: typeof changelog === "string" && changelog ? changelog : undefined,
      declaredSha256: sha256,
      declaredSizeBytes: sizeBytes,
      declaredMappingSha256: mappingSha256,
      declaredMappingSizeBytes: mappingSizeBytes,
      uploadedBy,
    });

    await logAdminAction(uploadedBy, "publish_build_ci", null, {
      downloadId: download.id,
      version,
      platform,
      draft: true,
    });

    // A draft changes nothing a customer sees; publish/unpublish revalidate /dashboard and /downloads.
    revalidatePath("/admin/downloads");

    return NextResponse.json({ ok: true, id: download.id, draft: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to confirm upload";
    const status = err instanceof PublishRefusedError ? err.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
