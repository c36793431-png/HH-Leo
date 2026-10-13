import { NextRequest, NextResponse } from "next/server";
import {
  PLATFORMS,
  SHA256_HEX,
  VERSION_PATTERN,
  DEFAULT_BUILD_FILENAME,
  PublishRefusedError,
  type Platform,
  assertVersionNotPublished,
  generatePublishUploadTokens,
  isBuildFilename,
  isPublishBearer,
} from "@/lib/publish-builds";

/**
 * Phase 1 of the agent/CI upload flow (bus threads horizon-portal-upload-endpoint-2026-08-13 and
 * agent-release-upload-2026-10-13). The uploader posts build metadata here and gets back two scoped
 * Blob upload tokens (build zip + obfuscar Mapping.txt) so it can PUT both directly to Blob,
 * bypassing the ~4.5MB serverless body cap. Nothing is written to the downloads table yet — that
 * happens in /confirm, as a draft. PUBLISH_API_TOKEN is deliberately separate from CRON_SECRET and
 * from admin session auth, and it can't publish: publishing is an admin-session action only.
 * A 409 is also how the uploader re-checks after a confirm timeout: 409 = the row landed.
 */
export async function POST(req: NextRequest) {
  if (!isPublishBearer(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const version = body?.version;
  const platform = body?.platform;
  const sha256 = body?.sha256;
  const size = body?.size;
  const filename = body?.filename === undefined ? DEFAULT_BUILD_FILENAME : body.filename;

  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    return NextResponse.json({ error: "version must look like 2.0.9 (2 to 4 numeric parts)" }, { status: 400 });
  }
  if (typeof platform !== "string" || !PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json({ error: "platform must be windows or macos" }, { status: 400 });
  }
  if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) {
    return NextResponse.json({ error: "sha256 must be a 64-char lowercase hex digest" }, { status: 400 });
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    return NextResponse.json({ error: "size must be a positive integer" }, { status: 400 });
  }
  if (!isBuildFilename(filename)) {
    return NextResponse.json({ error: "filename must be one path segment ending .zip, without / \\ or .." }, { status: 400 });
  }

  try {
    await assertVersionNotPublished(version, platform as Platform);

    const tokens = await generatePublishUploadTokens({ version, platform: platform as Platform, sha256, filename });

    return NextResponse.json({
      buildUpload: tokens.build,
      mappingUpload: tokens.mapping,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to prepare upload";
    const status = err instanceof PublishRefusedError ? err.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
