import { NextRequest, NextResponse } from "next/server";
import { PLATFORMS, type Platform, assertVersionNotPublished, generatePublishUploadTokens } from "@/lib/publish-builds";

/** Publish-scoped bearer token for the horizon-hft-client Actions pipeline — deliberately
 * separate from CRON_SECRET and from admin session auth, so it can be rotated or revoked
 * without touching either. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.PUBLISH_API_TOKEN;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Phase 1 of the CI auto-publish flow (bus thread horizon-portal-upload-endpoint-2026-08-13).
 * Actions posts build metadata here and gets back two scoped Blob upload tokens (build zip +
 * obfuscar mapping.txt) so it can PUT both directly to Blob, bypassing the ~4.5MB serverless
 * body cap. Nothing is written to the Versions table yet — that happens in /confirm.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const version = body?.version;
  const platform = body?.platform;
  const sha256 = body?.sha256;
  const size = body?.size;
  const filename = typeof body?.filename === "string" && body.filename ? body.filename : "horizon-hft-client.zip";

  if (typeof version !== "string" || !version) {
    return NextResponse.json({ error: "version is required" }, { status: 400 });
  }
  if (typeof platform !== "string" || !PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json({ error: "platform must be windows or macos" }, { status: 400 });
  }
  if (typeof sha256 !== "string" || sha256.length !== 64) {
    return NextResponse.json({ error: "sha256 must be a 64-char hex digest" }, { status: 400 });
  }
  if (typeof size !== "number" || size <= 0) {
    return NextResponse.json({ error: "size must be a positive number" }, { status: 400 });
  }

  try {
    await assertVersionNotPublished(version, platform as Platform);

    const tokens = await generatePublishUploadTokens({ version, platform: platform as Platform, filename });

    return NextResponse.json({
      buildUpload: tokens.build,
      mappingUpload: tokens.mapping,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to prepare publish upload";
    const alreadyPublished = message.includes("already published");
    return NextResponse.json({ error: message }, { status: alreadyPublished ? 409 : 500 });
  }
}
