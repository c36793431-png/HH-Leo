import crypto from "crypto";
import { put, del } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { pool } from "./db";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const ALLOWED_UPLOAD_CONTENT_TYPES = ["application/zip", "application/x-zip-compressed", "application/octet-stream"];

export type Platform = "windows" | "macos";
export const PLATFORMS: Platform[] = ["windows", "macos"];

/** Lowercase hex sha256, the only form any write path accepts (Fable S2, m66680). */
export const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The name a client's download is saved as (coxwell via marcus m68501/m68509): "HorizonHFT-<version>.zip", or
 * "HorizonHFT-<version>-macos.zip", never the stored Blob name (the manual upload adds a random suffix, and Windows
 * "Extract All" names the folder after the file). The version is reduced to [A-Za-z0-9._-] (runs of anything else
 * become one "-", repeated "-" collapse, ends trimmed) because the manual flow does not check its format; with nothing usable left it falls
 * back to "HorizonHFT". The extension is the stored file's when it is one (a letter then up to 7 letters/digits:
 * .zip, .dmg), else ".zip". */
export function downloadFilename(version: string, platform: Platform, pathname: string): string {
  const v = version.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[._-]+|[._-]+$/g, "");
  const base = /[A-Za-z0-9]/.test(v) ? `HorizonHFT-${v}` : "HorizonHFT";
  const ext = /\.[A-Za-z][A-Za-z0-9]{0,7}$/.exec(pathname.split("/").pop() ?? "")?.[0] ?? ".zip";
  return `${base}${platform === "macos" ? "-macos" : ""}${ext}`;
}

/** The Content-Disposition header for that name: a plain filename plus the RFC 5987 filename*. downloadFilename()
 * only returns [A-Za-z0-9._-], so neither form can carry a quote or a line break. */
export function downloadContentDisposition(filename: string): string {
  return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export interface DownloadRow {
  id: string;
  version: string;
  platform: Platform;
  blobPathname: string;
  sha256: string;
  sizeBytes: number;
  changelog: string | null;
  uploadedAt: Date;
  /** null = draft (0106): invisible to every customer reader until an admin publishes it. */
  publishedAt: Date | null;
}

/** Every reader selects exactly these. Never add mapping_*: maps are private to the server
 * (downloads-draft.test.ts pins it). */
export const DOWNLOAD_COLUMNS =
  "id, version, platform, blob_pathname, sha256, size_bytes, changelog, uploaded_at, published_at";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function toDownloadRow(row: any): DownloadRow {
  return {
    id: row.id,
    version: row.version,
    platform: row.platform,
    blobPathname: row.blob_pathname,
    sha256: row.sha256,
    sizeBytes: Number(row.size_bytes),
    changelog: row.changelog,
    uploadedAt: row.uploaded_at,
    publishedAt: row.published_at ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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

/** The manual flow's finalize takes the pathname back from the browser: it must be one file
 * directly under that version's downloads/ folder, so a row can never point at (and the file
 * route never serve, nor finalize's cleanup delete) a release's private Mapping.txt (Fable S4, m66691). */
export function isManualUploadPathname(platform: Platform, version: string, pathname: string): boolean {
  const prefix = buildBlobPathname(platform, version, "");
  const name = pathname.slice(prefix.length);
  return pathname.startsWith(prefix) && name.length > 0 && !/[\\/]/.test(name) && !pathname.split("/").includes("..");
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
  // The manual admin upload is live at insert, as before 0106: the admin uploading is the publisher.
  const result = await pool.query(
    `insert into downloads
       (version, platform, blob_url, blob_pathname, sha256, size_bytes, changelog, uploaded_by,
        published_at, published_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $8)
     returning ${DOWNLOAD_COLUMNS}`,
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
  return toDownloadRow(result.rows[0]);
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

/** Admin list: every non-deleted row, drafts included (the admin page shows a Draft pill). */
export async function listDownloads(): Promise<DownloadRow[]> {
  const result = await pool.query(
    `select ${DOWNLOAD_COLUMNS}
     from downloads where deleted_at is null
     order by uploaded_at desc`
  );
  return result.rows.map(toDownloadRow);
}

/** Dashboard/downloads-page source of truth: newest PUBLISHED non-deleted row per platform.
 * Ordered by publish time, so a draft uploaded earlier and published later is the latest, and
 * unpublishing the latest makes the previous one latest again (Fable (d), m66680). Not by version
 * text: 2.0.5.2 vs 2.0.6 doesn't sort as a string. */
export type LatestDownloads = Partial<Record<Platform, DownloadRow>>;

export async function getLatestDownloads(): Promise<LatestDownloads> {
  const result = await pool.query(`
    select distinct on (platform) ${DOWNLOAD_COLUMNS}
    from downloads
    where deleted_at is null and published_at is not null
    order by platform, published_at desc, uploaded_at desc
  `);
  const out: Partial<Record<Platform, DownloadRow>> = {};
  for (const row of result.rows) {
    out[row.platform as Platform] = toDownloadRow(row);
  }
  return out;
}

/** /api/download/<version>: any paid user can type any version string, so a draft must not resolve. */
export async function getDownloadByVersionPlatform(
  version: string,
  platform: Platform
): Promise<DownloadRow | null> {
  const result = await pool.query(
    `select ${DOWNLOAD_COLUMNS}
     from downloads where version = $1 and platform = $2 and deleted_at is null and published_at is not null
     limit 1`,
    [version, platform]
  );
  const row = result.rows[0];
  return row ? toDownloadRow(row) : null;
}

/** /api/download/file. includeDrafts is for an admin session only: it is how a draft gets
 * test-installed before anyone publishes it (Fable (c)). */
export async function getDownloadById(
  id: string,
  opts: { includeDrafts?: boolean } = {}
): Promise<DownloadRow | null> {
  const result = await pool.query(
    `select ${DOWNLOAD_COLUMNS}
     from downloads where id = $1 and deleted_at is null and ($2::boolean or published_at is not null)`,
    [id, opts.includeDrafts === true]
  );
  const row = result.rows[0];
  return row ? toDownloadRow(row) : null;
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
     returning ${DOWNLOAD_COLUMNS}`,
    [id, args.version ?? null, args.changelog ?? null]
  );
  const row = result.rows[0];
  if (!row) throw new Error("download not found");
  return toDownloadRow(row);
}

/** Draft -> live. Admin session only (publishDownloadAction); no bearer token reaches it. A fresh
 * published_at makes this row the platform's latest, also on a re-publish after an unpublish
 * (roll forward). */
export async function publishDownload(id: string, publishedBy: string): Promise<DownloadRow> {
  const result = await pool.query(
    `update downloads set published_at = now(), published_by = $2
     where id = $1 and deleted_at is null and published_at is null
     returning ${DOWNLOAD_COLUMNS}`,
    [id, publishedBy]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Not a draft (already published, deleted, or missing)");
  return toDownloadRow(row);
}

/** Live -> draft. Keeps the row and its blob (Delete stays the hard path). The version label stays
 * taken, so a rebuild of the same version needs Delete first. */
export async function unpublishDownload(id: string): Promise<DownloadRow> {
  const result = await pool.query(
    `update downloads set published_at = null, published_by = null
     where id = $1 and deleted_at is null and published_at is not null
     returning ${DOWNLOAD_COLUMNS}`,
    [id]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Not published (already a draft, deleted, or missing)");
  return toDownloadRow(row);
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
