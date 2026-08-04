import { del, get } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import crypto from "crypto";
import { pool } from "./db";

export const MAX_CV_BYTES = 5 * 1024 * 1024;
export const ALLOWED_CV_CONTENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export const APPLICATION_STATUSES = ["new", "reviewed", "contacted", "hired", "rejected"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const ROLE_INTERESTS = ["C# Developer", "Other"] as const;
export type RoleInterest = (typeof ROLE_INTERESTS)[number];

export interface ApplicationRow {
  id: string;
  name: string;
  email: string;
  roleInterest: string;
  message: string | null;
  cvUrl: string | null;
  status: ApplicationStatus;
  adminNotes: string | null;
  createdAt: Date;
}

function mapRow(row: {
  id: string;
  name: string;
  email: string;
  role_interest: string;
  message: string | null;
  cv_url: string | null;
  status: string;
  admin_notes: string | null;
  created_at: Date;
}): ApplicationRow {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roleInterest: row.role_interest,
    message: row.message,
    cvUrl: row.cv_url,
    status: row.status as ApplicationStatus,
    adminNotes: row.admin_notes,
    createdAt: row.created_at,
  };
}

/** Thrown when the same email has already applied within the rate-limit window. */
export class ApplicationRateLimitError extends Error {
  constructor() {
    super("You've already applied recently — we'll be in touch. Try again in 24h if this seems wrong.");
    this.name = "ApplicationRateLimitError";
  }
}

function buildCvPathname(filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `careers/applications/${crypto.randomUUID()}/${safeName}`;
}

/** Mints a scoped client token so the browser can PUT the CV straight to private Blob storage,
 * mirroring the downloads upload flow — avoids the server-action body-size limit for file uploads. */
export async function generateApplicationCvUploadToken(filename: string): Promise<{ token: string; pathname: string }> {
  const pathname = buildCvPathname(filename);
  const token = await generateClientTokenFromReadWriteToken({
    pathname,
    maximumSizeInBytes: MAX_CV_BYTES,
    allowedContentTypes: ALLOWED_CV_CONTENT_TYPES,
    addRandomSuffix: true,
  });
  return { token, pathname };
}

interface CreateApplicationArgs {
  name: string;
  email: string;
  roleInterest: string;
  message: string | null;
  cvBlobPathname: string | null;
}

/** Server-side rate limit: one submission per email per 24h — the authoritative check (the
 * client-side localStorage guard is a courtesy, not security, since it's trivially bypassed). */
export async function createApplication(args: CreateApplicationArgs): Promise<ApplicationRow> {
  const recent = await pool.query(
    `select 1 from applications where email = $1 and created_at > now() - interval '24 hours' limit 1`,
    [args.email]
  );
  if ((recent.rowCount ?? 0) > 0) throw new ApplicationRateLimitError();

  const result = await pool.query(
    `insert into applications (name, email, role_interest, message, cv_url)
     values ($1, $2, $3, $4, $5)
     returning id, name, email, role_interest, message, cv_url, status, admin_notes, created_at`,
    [args.name, args.email, args.roleInterest, args.message, args.cvBlobPathname]
  );
  return mapRow(result.rows[0]);
}

/** Cleans up an orphaned CV blob if the DB insert fails after upload — mirrors the downloads finalize failure path. */
export async function deleteCvBlob(pathname: string): Promise<void> {
  await del(pathname).catch(() => undefined);
}

export interface ListApplicationsOptions {
  status?: ApplicationStatus;
}

export async function listApplications(options: ListApplicationsOptions = {}): Promise<ApplicationRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    params.push(options.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await pool.query(
    `select id, name, email, role_interest, message, cv_url, status, admin_notes, created_at
     from applications ${where}
     order by created_at desc`,
    params
  );
  return result.rows.map(mapRow);
}

export async function getApplicationById(id: string): Promise<ApplicationRow | null> {
  const result = await pool.query(
    `select id, name, email, role_interest, message, cv_url, status, admin_notes, created_at
     from applications where id = $1`,
    [id]
  );
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

export async function updateApplicationStatus(id: string, status: ApplicationStatus): Promise<void> {
  await pool.query("update applications set status = $2 where id = $1", [id, status]);
}

export async function updateApplicationNotes(id: string, notes: string | null): Promise<void> {
  await pool.query("update applications set admin_notes = $2 where id = $1", [id, notes]);
}

/** Streams the private CV blob server-side for the admin-only download route — the Blob URL is never exposed to the browser. */
export async function getCvBlobStream(pathname: string) {
  const blob = await get(pathname, { access: "private" });
  if (!blob || blob.statusCode !== 200) return null;
  return blob;
}
