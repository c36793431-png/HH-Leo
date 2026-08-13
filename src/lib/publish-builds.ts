import crypto from "crypto";
import { del, get } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { pool } from "./db";
import { PLATFORMS, type Platform, type DownloadRow } from "./downloads";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const MAX_MAPPING_BYTES = 50 * 1024 * 1024;
const ZIP_CONTENT_TYPES = ["application/zip", "application/x-zip-compressed", "application/octet-stream"];
const MAPPING_CONTENT_TYPES = ["text/plain", "application/octet-stream"];

export { PLATFORMS, type Platform };

function buildPathname(platform: Platform, version: string, filename: string): string {
  return `downloads/${platform}/${version}/${filename}`;
}

function mappingPathname(platform: Platform, version: string): string {
  return `mappings/${platform}/${version}/mapping.txt`;
}

export interface PublishMetadata {
  version: string;
  platform: Platform;
  filename: string;
}

export interface PublishUploadTokens {
  build: { token: string; pathname: string };
  mapping: { token: string; pathname: string };
}

/** Called by Actions before it PUTs anything — fails loudly if the version+platform
 * is already published so a re-tagged build can never silently overwrite a shipped one. */
export async function assertVersionNotPublished(version: string, platform: Platform): Promise<void> {
  const existing = await pool.query(
    "select id from downloads where version = $1 and platform = $2 and deleted_at is null",
    [version, platform]
  );
  if (existing.rowCount) {
    throw new Error(`version ${version} (${platform}) is already published`);
  }
}

/** Mints scoped client tokens for the two files Actions uploads directly to Blob,
 * bypassing the ~4.5MB serverless body cap — same pattern as the manual admin upload,
 * plus a second token for the obfuscar mapping.txt (indefinite retention). */
export async function generatePublishUploadTokens({
  version,
  platform,
  filename,
}: PublishMetadata): Promise<PublishUploadTokens> {
  const buildPath = buildPathname(platform, version, filename);
  const mapPath = mappingPathname(platform, version);

  const [buildToken, mappingToken] = await Promise.all([
    generateClientTokenFromReadWriteToken({
      pathname: buildPath,
      maximumSizeInBytes: MAX_UPLOAD_BYTES,
      allowedContentTypes: ZIP_CONTENT_TYPES,
      addRandomSuffix: true,
    }),
    generateClientTokenFromReadWriteToken({
      pathname: mapPath,
      maximumSizeInBytes: MAX_MAPPING_BYTES,
      allowedContentTypes: MAPPING_CONTENT_TYPES,
      addRandomSuffix: true,
    }),
  ]);

  return {
    build: { token: buildToken, pathname: buildPath },
    mapping: { token: mappingToken, pathname: mapPath },
  };
}

async function hashBlob(pathname: string): Promise<{ sha256: string; sizeBytes: number }> {
  const blob = await get(pathname, { access: "private" });
  if (!blob || blob.statusCode !== 200) {
    throw new Error(`could not read uploaded blob at ${pathname}`);
  }
  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of blob.stream as unknown as AsyncIterable<Uint8Array>) {
    hash.update(chunk);
    sizeBytes += chunk.byteLength;
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

export interface ConfirmPublishArgs {
  version: string;
  platform: Platform;
  changelog?: string;
  buildBlobUrl: string;
  buildBlobPathname: string;
  mappingBlobUrl: string;
  mappingBlobPathname: string;
  declaredSha256: string;
  declaredSizeBytes: number;
  publishedBy: string;
}

/** Verifies the uploaded build's actual bytes hash to the sha256 Actions declared in
 * phase 1 before touching the Versions table — a stronger guarantee than the manual
 * admin form gives, since a CI-driven write path has no human eyeballing the file.
 * A hash mismatch, or the version having been published by a concurrent run in the
 * meantime, cleans up both blobs and leaves no half-published row. */
export async function confirmPublishedBuild(args: ConfirmPublishArgs): Promise<DownloadRow> {
  const cleanup = () =>
    Promise.all([del(args.buildBlobPathname).catch(() => undefined), del(args.mappingBlobPathname).catch(() => undefined)]);

  let actual: { sha256: string; sizeBytes: number };
  try {
    actual = await hashBlob(args.buildBlobPathname);
  } catch (err) {
    await cleanup();
    throw err;
  }

  if (actual.sizeBytes !== args.declaredSizeBytes || actual.sha256 !== args.declaredSha256) {
    await cleanup();
    throw new Error("uploaded build does not match declared sha256/size — publish rejected");
  }

  try {
    const result = await pool.query(
      `insert into downloads
         (version, platform, blob_url, blob_pathname, sha256, size_bytes, changelog,
          uploaded_by, mapping_blob_url, mapping_blob_pathname, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ci')
       returning id, version, platform, blob_pathname, sha256, size_bytes, changelog, uploaded_at`,
      [
        args.version,
        args.platform,
        args.buildBlobUrl,
        args.buildBlobPathname,
        actual.sha256,
        actual.sizeBytes,
        args.changelog ?? null,
        args.publishedBy,
        args.mappingBlobUrl,
        args.mappingBlobPathname,
      ]
    );
    const row = result.rows[0];
    return {
      id: row.id,
      version: row.version,
      platform: row.platform,
      blobPathname: row.blob_pathname,
      sha256: row.sha256,
      sizeBytes: Number(row.size_bytes),
      changelog: row.changelog,
      uploadedAt: row.uploaded_at,
    };
  } catch (err) {
    await cleanup();
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("downloads_version_platform_live_uidx")) {
      throw new Error(`version ${args.version} (${args.platform}) is already published`);
    }
    throw err;
  }
}
