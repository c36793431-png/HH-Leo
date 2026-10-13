import crypto from "crypto";
import { del, get } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { pool } from "./db";
import { PLATFORMS, SHA256_HEX, DOWNLOAD_COLUMNS, toDownloadRow, type Platform, type DownloadRow } from "./downloads";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const MAX_MAPPING_BYTES = 50 * 1024 * 1024;
const ZIP_CONTENT_TYPES = ["application/zip", "application/x-zip-compressed", "application/octet-stream"];
const MAPPING_CONTENT_TYPES = ["text/plain", "application/octet-stream"];

export { PLATFORMS, SHA256_HEX, type Platform };

/** 2.0.8, 2.0.5.2: two to four numeric parts (Fable S2, m66680). Pathname-safe by construction. */
export const VERSION_PATTERN = /^\d+(\.\d+){1,3}$/;
export const DEFAULT_BUILD_FILENAME = "horizon-hft-client.zip";

/** One pathname segment ending .zip: no "/", "\" or "..". It becomes the last segment of the
 * build's Blob pathname, and so the filename a customer's download is saved as. */
export function isBuildFilename(name: unknown): name is string {
  return typeof name === "string" && name.length <= 200 && /^[^/\\]+\.zip$/.test(name) && !name.includes("..");
}

/** Both pathnames are computed here from validated parts and never taken from the caller (the
 * structural variant of Fable S1). Keyed by the zip's sha256 and minted with no random suffix and
 * no overwrite, so a pathname only ever holds the bytes of that one build, a duplicate upload fails
 * loudly instead of overwriting, and a confirm can only reach its own build's two blobs. The map
 * path is the one marcus ruled in m66684. */
export function publishPathnames(platform: Platform, version: string, sha256: string, filename: string) {
  return {
    build: `downloads/${platform}/${version}/${sha256}/${filename}`,
    mapping: `mappings/${platform}/${version}/${sha256}/Mapping.txt`,
  };
}

/** The Authorization header carries PUBLISH_API_TOKEN, compared in constant time. The token is
 * draft-only: the two routes it opens can upload and record a draft, never publish one. Unset =
 * every call refused. */
export function isPublishBearer(authorization: string | null): boolean {
  const secret = process.env.PUBLISH_API_TOKEN;
  if (!secret || !authorization) return false;
  const expected = crypto.createHash("sha256").update(`Bearer ${secret}`).digest();
  const actual = crypto.createHash("sha256").update(authorization).digest();
  return crypto.timingSafeEqual(expected, actual);
}

/** A refusal with the HTTP status the route returns for it. */
export class PublishRefusedError extends Error {
  constructor(
    message: string,
    readonly status: 409 | 422
  ) {
    super(message);
  }
}

export interface PublishMetadata {
  version: string;
  platform: Platform;
  sha256: string;
  filename: string;
}

export interface PublishUploadTokens {
  build: { token: string; pathname: string };
  mapping: { token: string; pathname: string };
}

/** Phase 1 and confirm both call this first. A row for the version+platform, draft or published,
 * refuses with nothing touched: a rebuild of a version needs Delete of the old row first (marcus
 * m66684, Fable (e)). */
export async function assertVersionNotPublished(version: string, platform: Platform): Promise<void> {
  const existing = await pool.query(
    "select id from downloads where version = $1 and platform = $2 and deleted_at is null",
    [version, platform]
  );
  if (existing.rowCount) {
    throw new PublishRefusedError(`version ${version} (${platform}) already exists (draft or published)`, 409);
  }
}

/** Mints scoped client tokens for the two files the uploader PUTs directly to Blob, bypassing the
 * ~4.5MB serverless body cap — same pattern as the manual admin upload, plus a second token for
 * the obfuscar Mapping.txt (indefinite retention). */
export async function generatePublishUploadTokens({
  version,
  platform,
  sha256,
  filename,
}: PublishMetadata): Promise<PublishUploadTokens> {
  const paths = publishPathnames(platform, version, sha256, filename);

  const [buildToken, mappingToken] = await Promise.all([
    generateClientTokenFromReadWriteToken({
      pathname: paths.build,
      maximumSizeInBytes: MAX_UPLOAD_BYTES,
      allowedContentTypes: ZIP_CONTENT_TYPES,
      addRandomSuffix: false,
      allowOverwrite: false,
    }),
    generateClientTokenFromReadWriteToken({
      pathname: paths.mapping,
      maximumSizeInBytes: MAX_MAPPING_BYTES,
      allowedContentTypes: MAPPING_CONTENT_TYPES,
      addRandomSuffix: false,
      allowOverwrite: false,
    }),
  ]);

  return {
    build: { token: buildToken, pathname: paths.build },
    mapping: { token: mappingToken, pathname: paths.mapping },
  };
}

/** Streams a private blob through a hash; null when there is no blob at the pathname. */
async function hashBlob(pathname: string): Promise<{ sha256: string; sizeBytes: number; url: string } | null> {
  const blob = await get(pathname, { access: "private" });
  if (!blob) return null;
  if (blob.statusCode !== 200) throw new Error(`could not read uploaded blob at ${pathname}`);
  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of blob.stream as unknown as AsyncIterable<Uint8Array>) {
    hash.update(chunk);
    sizeBytes += chunk.byteLength;
  }
  return { sha256: hash.digest("hex"), sizeBytes, url: blob.blob.url };
}

/** Which of these pathnames a downloads row points at, in either column. With keptMaps, a deleted
 * row's map counts too: Delete keeps maps, because installed clients' crash logs need them. Every
 * cleanup del() asks this first: confirm here, and the manual finalize route (it lives here because
 * this is the only file that names the map columns, S4). */
export async function pathnamesInUse(pathnames: string[], opts: { keptMaps: boolean }): Promise<Set<string>> {
  const result = await pool.query<{ pathname: string }>(
    `select blob_pathname as pathname from downloads
       where deleted_at is null and blob_pathname = any($1::text[])
     union
     select mapping_blob_pathname from downloads
       where ($2::boolean or deleted_at is null) and mapping_blob_pathname = any($1::text[])`,
    [pathnames, opts.keptMaps]
  );
  return new Set(result.rows.map((r) => r.pathname));
}

export interface ConfirmPublishArgs {
  version: string;
  platform: Platform;
  filename: string;
  changelog?: string;
  declaredSha256: string;
  declaredSizeBytes: number;
  declaredMappingSha256: string;
  declaredMappingSizeBytes: number;
  uploadedBy: string;
}

/** Records a DRAFT after re-hashing both uploaded blobs server-side. Never publishes: published_at
 * is the literal null below and nothing a caller sends can change it (marcus m66684). Order (Fable
 * S1): the version check, then the live-or-draft pathname check, both before any get or del; a
 * refusal there touches nothing. A refusal after the reads deletes this upload's blobs, re-checked
 * at that moment, and never a pathname a row points at (a deleted row's kept map included). */
export async function confirmPublishedBuild(args: ConfirmPublishArgs): Promise<DownloadRow> {
  await assertVersionNotPublished(args.version, args.platform);

  const paths = publishPathnames(args.platform, args.version, args.declaredSha256, args.filename);
  const both = [paths.build, paths.mapping];
  const taken = await pathnamesInUse(both, { keptMaps: false });
  if (taken.size) {
    throw new PublishRefusedError(`pathname belongs to a live or draft release: ${[...taken].join(", ")}`, 422);
  }

  const cleanup = async () => {
    // If the check itself fails, delete nothing.
    const inUse = await pathnamesInUse(both, { keptMaps: true }).catch(() => new Set(both));
    await Promise.all(both.filter((p) => !inUse.has(p)).map((p) => del(p).catch(() => undefined)));
  };
  const refuse = async (message: string): Promise<never> => {
    await cleanup();
    throw new PublishRefusedError(message, 422);
  };

  let build: Awaited<ReturnType<typeof hashBlob>>;
  let mapping: Awaited<ReturnType<typeof hashBlob>>;
  try {
    build = await hashBlob(paths.build);
    mapping = build ? await hashBlob(paths.mapping) : null;
  } catch (err) {
    return refuse(err instanceof Error ? err.message : String(err));
  }
  if (!build) return refuse(`no uploaded build at ${paths.build}`);
  if (build.sizeBytes !== args.declaredSizeBytes || build.sha256 !== args.declaredSha256) {
    return refuse("uploaded build does not match declared sha256/size — upload rejected");
  }
  if (!mapping) return refuse(`no uploaded Mapping.txt at ${paths.mapping}`);
  if (mapping.sizeBytes !== args.declaredMappingSizeBytes || mapping.sha256 !== args.declaredMappingSha256) {
    return refuse("uploaded Mapping.txt does not match declared mappingSha256/mappingSizeBytes — upload rejected");
  }

  try {
    const result = await pool.query(
      `insert into downloads
         (version, platform, blob_url, blob_pathname, sha256, size_bytes, changelog, uploaded_by,
          mapping_blob_url, mapping_blob_pathname, mapping_sha256, mapping_size_bytes, source,
          published_at, published_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ci', null, null)
       returning ${DOWNLOAD_COLUMNS}`,
      [
        args.version,
        args.platform,
        build.url,
        paths.build,
        build.sha256,
        build.sizeBytes,
        args.changelog ?? null,
        args.uploadedBy,
        mapping.url,
        paths.mapping,
        mapping.sha256,
        mapping.sizeBytes,
      ]
    );
    return toDownloadRow(result.rows[0]);
  } catch (err) {
    await cleanup();
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("downloads_version_platform_live_uidx")) {
      throw new PublishRefusedError(`version ${args.version} (${args.platform}) already exists (draft or published)`, 409);
    }
    throw err;
  }
}
