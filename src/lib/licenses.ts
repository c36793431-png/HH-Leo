import crypto from "crypto";
import { pool } from "./db";

interface ClaimArgs {
  userId: string;
  email?: string;
  telegramUserId?: number;
}

// Crockford-ish alphabet, no 0/O/1/I — avoids transcription ambiguity when a client reads a key aloud.
const KEY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomKeySegment(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return out;
}

export function generateLicenseKey(): string {
  return `HHFT-${randomKeySegment(6)}-${randomKeySegment(6)}-${randomKeySegment(6)}`;
}

interface IssueLicenseArgs {
  userId?: string;
  claimEmail?: string;
  claimTelegramUserId?: number;
  ttlDays?: number;
  notes?: string;
}

export interface IssuedLicense {
  id: string;
  licenseKey: string;
  expiresAt: Date;
}

/** Creates an active license row bound to an existing user, or pre-provisioned by claim_email/claim_telegram_user_id ahead of signup. */
export async function issueLicense(args: IssueLicenseArgs): Promise<IssuedLicense> {
  const ttlDays = args.ttlDays ?? 30;
  for (let attempt = 0; attempt < 5; attempt++) {
    const licenseKey = generateLicenseKey();
    try {
      const result = await pool.query(
        `insert into licenses (user_id, claim_email, claim_telegram_user_id, license_key, status, expires_at, notes)
         values ($1, $2, $3, $4, 'active', now() + ($5 || ' days')::interval, $6)
         returning id, license_key, expires_at`,
        [
          args.userId ?? null,
          args.claimEmail ?? null,
          args.claimTelegramUserId ?? null,
          licenseKey,
          ttlDays,
          args.notes ?? null,
        ]
      );
      const row = result.rows[0];
      return { id: row.id, licenseKey: row.license_key, expiresAt: row.expires_at };
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "23505") continue; // license_key collision — retry with a fresh key
      throw err;
    }
  }
  throw new Error("issueLicense: failed to generate a unique license key after 5 attempts");
}

export async function extendLicense(licenseId: string, extendDays: number): Promise<void> {
  await pool.query(
    `update licenses
     set expires_at = greatest(expires_at, now()) + ($2 || ' days')::interval,
         lifecycle_state = null
     where id = $1`,
    [licenseId, extendDays]
  );
}

export async function revokeLicense(licenseId: string): Promise<void> {
  await pool.query(
    `update licenses set status = 'revoked', lifecycle_state = 'expired_processed' where id = $1`,
    [licenseId]
  );
}

export interface GroupTarget {
  userId: string;
  telegramUserId: string | null;
  email: string | null;
}

/** Fresh-read lookup for group-membership actions — never trust the JWT session for telegram_user_id, it can go stale after a Link Telegram flow. */
export async function getGroupTarget(userId: string): Promise<GroupTarget | null> {
  const result = await pool.query<{ id: string; telegram_user_id: string | null; email: string | null }>(
    "select id, telegram_user_id, email from users where id = $1",
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { userId: row.id, telegramUserId: row.telegram_user_id, email: row.email };
}

export interface ClientRow {
  userId: string;
  email: string | null;
  telegramUsername: string | null;
  telegramUserId: string | null;
  displayName: string | null;
  paid: boolean;
  licenseId: string | null;
  licenseKey: string | null;
  expiresAt: Date | null;
  status: string | null;
}

/** Admin client list: every non-admin user joined to their most recent license, with computed paid state. */
export async function listClients(): Promise<ClientRow[]> {
  const result = await pool.query(`
    select u.id as user_id, u.email, u.telegram_username, u.telegram_user_id, u.display_name,
           l.id as license_id, l.license_key, l.expires_at, l.status
    from users u
    left join lateral (
      select id, license_key, expires_at, status
      from licenses
      where user_id = u.id
      order by issued_at desc
      limit 1
    ) l on true
    where u.role = 'user'
    order by u.created_at desc
  `);
  return result.rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    telegramUsername: r.telegram_username,
    telegramUserId: r.telegram_user_id !== null ? String(r.telegram_user_id) : null,
    displayName: r.display_name,
    licenseId: r.license_id,
    licenseKey: r.license_key,
    expiresAt: r.expires_at,
    status: r.status,
    paid: r.status === "active" && r.expires_at !== null && new Date(r.expires_at) > new Date(),
  }));
}

export interface ActiveLicense {
  licenseKey: string;
  expiresAt: Date;
}

export async function getActiveLicenseForUser(userId: string): Promise<ActiveLicense | null> {
  const result = await pool.query(
    `select license_key, expires_at from licenses
     where user_id = $1 and status = 'active' and expires_at > now()
     order by expires_at desc
     limit 1`,
    [userId]
  );
  const row = result.rows[0];
  return row ? { licenseKey: row.license_key, expiresAt: row.expires_at } : null;
}

export interface VerifyLicenseResult {
  status: "active" | "expired" | "revoked" | "not_found";
  expiresAt: Date | null;
}

/** Canonical /api/verify-license lookup — also stamps last_verified_at for phone-home telemetry. */
export async function verifyLicenseKey(licenseKey: string): Promise<VerifyLicenseResult> {
  const result = await pool.query(
    `update licenses set last_verified_at = now()
     where license_key = $1
     returning status, expires_at`,
    [licenseKey]
  );
  const row = result.rows[0];
  if (!row) return { status: "not_found", expiresAt: null };
  if (row.status === "revoked") return { status: "revoked", expiresAt: row.expires_at };
  if (new Date(row.expires_at) <= new Date()) return { status: "expired", expiresAt: row.expires_at };
  return { status: "active", expiresAt: row.expires_at };
}

/**
 * Atomically claims any pre-provisioned license matching this user's verified
 * email or Telegram ID. WHERE user_id IS NULL makes concurrent claims lose
 * harmlessly (spec: Pre-provision + claim).
 */
/** Canonical paid-state check — licenses table is the single source of truth, computed at read time. */
export async function isPaidUser(userId: string): Promise<boolean> {
  const result = await pool.query(
    `select 1 from licenses
     where user_id = $1 and status = 'active' and expires_at > now()
     limit 1`,
    [userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export interface LicenseDetail {
  id: string;
  licenseKey: string;
  status: string;
  tier: string;
  expiresAt: Date;
  hardwareId: string | null;
  lastVerifiedAt: Date | null;
}

/** Dashboard widget lookup — unlike getActiveLicenseForUser, returns the latest license regardless of status/expiry so the UI can render EXPIRED/REVOKED states. */
export async function getLicenseForUser(userId: string): Promise<LicenseDetail | null> {
  const result = await pool.query(
    `select id, license_key, status, tier, expires_at, hardware_id, last_verified_at
     from licenses where user_id = $1
     order by issued_at desc
     limit 1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    licenseKey: row.license_key,
    status: row.status,
    tier: row.tier,
    expiresAt: row.expires_at,
    hardwareId: row.hardware_id,
    lastVerifiedAt: row.last_verified_at,
  };
}

/** Masks all but the last 4 characters — used wherever an admin views another user's key. Owners viewing their own key see it in full. */
export function maskLicenseKey(key: string): string {
  const last4 = key.slice(-4);
  return key.slice(0, -4).replace(/[A-Za-z0-9]/g, "X") + last4;
}

export async function claimPendingLicense({ userId, email, telegramUserId }: ClaimArgs) {
  if (email) {
    await pool.query(
      `update licenses set user_id = $1, claim_email = null
       where user_id is null and claim_email = $2`,
      [userId, email]
    );
  }
  if (telegramUserId !== undefined) {
    await pool.query(
      `update licenses set user_id = $1, claim_telegram_user_id = null
       where user_id is null and claim_telegram_user_id = $2`,
      [userId, telegramUserId]
    );
  }
}
