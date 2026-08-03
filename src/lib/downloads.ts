import crypto from "crypto";
import { put, del } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { pool } from "./db";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const ALLOWED_UPLOAD_CONTENT_TYPES = ["application/zip", "application/x-zip-compressed", "application/octet-stream"];

export type Platform = "windows" | "macos";
export const PLATFORMS: Platform[] = ["windows", "macos"];

export interface DownloadRow {
  id: string;
  version: string;
  platform: Platform;
  blobPathname: string;
  sha256: string;
  sizeBytes: number;
  changelog: string | null;
  uploadedAt: Date;
}

interface CreateDownloadArgs {
  file: File;
  version: string;
  platform: Platform;
  changelog?: string;
  uploadedBy: string;
}

function buildBlobPathname(platform: Platform, version: string, filename: string): string {
  return `downloads/${platform}/${version}/${filename}`;
}

async function insertDownloadRow(args: {
  version: string;
  platform: Platform;
  blobUrl: string;
  blobPathname: string;
  sha256: string;
  sizeBytes: number;
  changelog?: string;
  uploadedBy: string;
}): Promise<DownloadRow> {
  const result = await pool.query(
    `insert into downloads (version, platform, blob_url, blob_pathname, sha256, size_bytes, changelog, uploaded_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, version, platform, blob_pathname, sha256, size_bytes, changelog, uploaded_at`,
    [
      args.version,
      args.platform,
      args.blobUrl,
      args.blobPathname,
      args.sha256,
      args.sizeBytes,
      args.changelog ?? null,
      args.uploadedBy,
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
}

interface GenerateUploadTokenArgs {
  version: string;
  platform: Platform;
  filename: string;
}

/** Mints a scoped client token so the browser can PUT the build directly to Blob storage,
 * bypassing the ~4.5MB body-size limit on Vercel serverless functions/server actions. */
export async function generateDownloadUploadToken({
  version,
  platform,
  filename,
}: GenerateUploadTokenArgs): Promise<{ token: string; pathname: string }> {
  const pathname = buildBlobPathname(platform, version, filename);
  const token = await generateClientTokenFromReadWriteToken({
    pathname,
    maximumSizeInBytes: MAX_UPLOAD_BYTES,
    allowedContentTypes: ALLOWED_UPLOAD_CONTENT_TYPES,
    addRandomSuffix: true,
  });
  return { token, pathname };
}

interface FinalizeDownloadUploadArgs {
  blobUrl: string;
  blobPathname: string;
  version: string;
  platform: Platform;
  changelog?: string;
  sha256: string;
  sizeBytes: number;
  uploadedBy: string;
}

/** Records the version row after the browser has already PUT the file straight to Blob —
 * the metadata-only counterpart to the direct-upload flow started by generateDownloadUploadToken. */
export async function finalizeDownloadUpload(args: FinalizeDownloadUploadArgs): Promise<DownloadRow> {
  return insertDownloadRow(args);
}

/** Uploads a build to private Vercel Blob storage, hashes it, and records the version row — the canonical write path for both the admin UI and the /api/admin/downloads/upload API. */
export async function createDownload({
  file,
  version,
  platform,
  changelog,
  uploadedBy,
}: CreateDownloadArgs): Promise<DownloadRow> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  const pathname = buildBlobPathname(platform, version, file.name);
  const blob = await put(pathname, buffer, { access: "private" });

  return insertDownloadRow({
    version,
    platform,
    blobUrl: blob.url,
    blobPathname: blob.pathname,
    sha256,
    sizeBytes: buffer.byteLength,
    changelog,
    uploadedBy,
  });
}

export async function listDownloads(): Promise<DownloadRow[]> {
  const result = await pool.query(
    `select id, version, platform, blob_pathname, sha256, size_bytes, changelog, uploaded_at
     from downloads where deleted_at is null
     order by uploaded_at desc`
  );
  return result.rows.map((row) => ({
    id: row.id,
    version: row.version,
    platform: row.platform,
    blobPathname: row.blob_pathname,
    sha256: row.sha256,
    sizeBytes: Number(row.size_bytes),
    changelog: row.changelog,
    uploadedAt: row.uploaded_at,
  }));
}

/** Dashboard/downloads-page source of truth: newest non-deleted row per platform. */
export type LatestDownloads = Partial<Record<Platform, DownloadRow>>;

export async function getLatestDownloads(): Promise<LatestDownloads> {
  const result = await pool.query(`
    select distinct on (platform) id, version, platform, blob_pathname, sha256, size_bytes, changelog, uploaded_at
    from downloads
    where deleted_at is null
    order by platform, uploaded_at desc
  `);
  const out: Partial<Record<Platform, DownloadRow>> = {};
  for (const row of result.rows) {
    out[row.platform as Platform] = {
      id: row.id,
      version: row.version,
      platform: row.platform,
      blobPathname: row.blob_pathname,
      sha256: row.sha256,
      sizeBytes: Number(row.size_bytes),
      changelog: row.changelog,
      uploadedAt: row.uploaded_at,
    };
  }
  return out;
}

export async function getDownloadByVersionPlatform(
  version: string,
  platform: Platform
): Promise<DownloadRow | null> {
  const result = await pool.query(
    `select id, version, platform, blob_pathname, sha256, size_bytes, changelog, uploaded_at
     from downloads where version = $1 and platform = $2 and deleted_at is null
     limit 1`,
    [version, platform]
  );
  const row = result.rows[0];
  if (!row) return null;
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
}

export async function getDownloadById(id: string): Promise<DownloadRow | null> {
  const result = await pool.query(
    `select id, version, platform, blob_pathname, sha256, size_bytes, changelog, uploaded_at
     from downloads where id = $1 and deleted_at is null`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
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
}

interface UpdateDownloadMetadataArgs {
  version?: string;
  changelog?: string;
}

/** Row-level metadata fix (typo'd version string, changelog edit) — never touches the uploaded Blob. */
export async function updateDownloadMetadata(
  id: string,
  args: UpdateDownloadMetadataArgs
): Promise<DownloadRow> {
  const result = await pool.query(
    `update downloads set version = coalesce($2, version), changelog = coalesce($3, changelog)
     where id = $1 and deleted_at is null
     returning id, version, platform, blob_pathname, sha256, size_bytes, changelog, uploaded_at`,
    [id, args.version ?? null, args.changelog ?? null]
  );
  const row = result.rows[0];
  if (!row) throw new Error("download not found");
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
}

/** Soft-delete: keeps the row (and admin_actions audit trail) but removes it from listings and the Blob store. */
export async function softDeleteDownload(id: string): Promise<void> {
  const result = await pool.query<{ blob_pathname: string }>(
    "update downloads set deleted_at = now() where id = $1 and deleted_at is null returning blob_pathname",
    [id]
  );
  const pathname = result.rows[0]?.blob_pathname;
  if (pathname) await del(pathname).catch(() => undefined);
}
