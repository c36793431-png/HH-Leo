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

export interface AdminUserRow {
  userId: string;
  email: string | null;
  displayName: string | null;
  telegramUsername: string | null;
  joinedAt: Date;
  signupSource: "telegram" | "email-link" | "both" | null;
  licenseId: string | null;
  licenseKey: string | null;
  status: string | null;
  computedStatus: "active" | "expired" | "revoked" | "none";
  expiresAt: Date | null;
  tier: string | null;
  hardwareId: string | null;
  lastVerifiedAt: Date | null;
}

export type HasLicenseFilter = "active" | "expired" | "revoked" | "none";
export type SignupSourceFilter = "telegram" | "email-link" | "both";
export type UsersSortColumn = "joined_at" | "last_verified_at" | "expires_at";
export type SortDir = "asc" | "desc";

export interface ListUsersOptions {
  search?: string;
  hasLicense?: HasLicenseFilter;
  signupSource?: SignupSourceFilter;
  sort?: UsersSortColumn;
  dir?: SortDir;
  page?: number;
  perPage?: number;
}

const USERS_SORT_COLUMN_SQL: Record<UsersSortColumn, string> = {
  joined_at: "u.created_at",
  last_verified_at: "l.last_verified_at",
  expires_at: "l.expires_at",
};

const COMPUTED_STATUS_SQL = `
  case
    when l.id is null then 'none'
    when l.status = 'revoked' then 'revoked'
    when l.expires_at <= now() then 'expired'
    else 'active'
  end
`;

const SIGNUP_SOURCE_SQL = `
  case
    when u.telegram_user_id is not null and u.email is not null then 'both'
    when u.telegram_user_id is not null then 'telegram'
    when u.email is not null then 'email-link'
    else null
  end
`;

/** /admin/users source of truth: every user joined to their most recent license, with search/filter/sort/pagination. */
export async function listAllUsersWithLicenses(
  options: ListUsersOptions = {}
): Promise<{ rows: AdminUserRow[]; total: number }> {
  const perPage = options.perPage ?? 50;
  const page = Math.max(1, options.page ?? 1);
  const offset = (page - 1) * perPage;
  const sortColumn = USERS_SORT_COLUMN_SQL[options.sort ?? "joined_at"];
  const dir = options.dir === "asc" ? "asc" : "desc";

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    params.push(`%${options.search}%`);
    const idx = params.length;
    conditions.push(
      `(u.email ilike $${idx} or u.display_name ilike $${idx} or u.telegram_username ilike $${idx})`
    );
  }
  if (options.hasLicense) {
    params.push(options.hasLicense);
    conditions.push(`${COMPUTED_STATUS_SQL} = $${params.length}`);
  }
  if (options.signupSource) {
    params.push(options.signupSource);
    conditions.push(`${SIGNUP_SOURCE_SQL} = $${params.length}`);
  }

  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";

  const baseFrom = `
    from users u
    left join lateral (
      select id, license_key, status, expires_at, tier, hardware_id, last_verified_at
      from licenses
      where user_id = u.id
      order by issued_at desc
      limit 1
    ) l on true
  `;

  const countResult = await pool.query<{ count: string }>(`select count(*) ${baseFrom} ${where}`, params);
  const total = Number(countResult.rows[0]?.count ?? 0);

  params.push(perPage);
  params.push(offset);
  const result = await pool.query(
    `select u.id as user_id, u.email, u.display_name, u.telegram_username, u.created_at,
            ${SIGNUP_SOURCE_SQL} as signup_source,
            l.id as license_id, l.license_key, l.status, l.expires_at, l.tier,
            l.hardware_id, l.last_verified_at,
            ${COMPUTED_STATUS_SQL} as computed_status
     ${baseFrom}
     ${where}
     order by ${sortColumn} ${dir} nulls last
     limit $${params.length - 1} offset $${params.length}`,
    params
  );

  return {
    total,
    rows: result.rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      telegramUsername: r.telegram_username,
      joinedAt: r.created_at,
      signupSource: r.signup_source,
      licenseId: r.license_id,
      licenseKey: r.license_key,
      status: r.status,
      computedStatus: r.computed_status,
      expiresAt: r.expires_at,
      tier: r.tier,
      hardwareId: r.hardware_id,
      lastVerifiedAt: r.last_verified_at,
    })),
  };
}

export interface UserLicenseRow {
  id: string;
  licenseKey: string;
  status: string;
  computedStatus: "active" | "expired" | "revoked";
  tier: string;
  issuedAt: Date;
  expiresAt: Date;
  hardwareId: string | null;
  lastVerifiedAt: Date | null;
}

export interface SigninEventRow {
  id: string;
  provider: string;
  createdAt: Date;
}

export interface UserDetailAdminActionRow {
  id: string;
  action: string;
  actorEmail: string | null;
  targetLicenseId: string | null;
  details: unknown;
  createdAt: Date;
}

export interface UserDetail {
  userId: string;
  email: string | null;
  displayName: string | null;
  telegramUsername: string | null;
  telegramUserId: string | null;
  role: string;
  joinedAt: Date;
  licenses: UserLicenseRow[];
  signins: SigninEventRow[];
  adminActions: UserDetailAdminActionRow[];
}

/** /admin/users/[id] source of truth: full profile, every license (past + present), signin history, admin actions taken against them. */
export async function getUserDetail(userId: string): Promise<UserDetail | null> {
  const userResult = await pool.query(
    `select id, email, display_name, telegram_username, telegram_user_id, role, created_at
     from users where id = $1`,
    [userId]
  );
  const user = userResult.rows[0];
  if (!user) return null;

  const [licensesResult, signinsResult, actionsResult] = await Promise.all([
    pool.query(
      `select id, license_key, status, tier, issued_at, expires_at, hardware_id, last_verified_at,
              case when status = 'revoked' then 'revoked'
                   when expires_at <= now() then 'expired'
                   else 'active' end as computed_status
       from licenses where user_id = $1
       order by issued_at desc`,
      [userId]
    ),
    pool.query(
      `select id, provider, created_at from signin_events
       where user_id = $1 order by created_at desc limit 20`,
      [userId]
    ),
    pool.query(
      `select a.id, a.action_type, au.email as actor_email, a.target_license_id, a.details_json, a.created_at
       from admin_actions a
       left join users au on au.id = a.admin_user_id
       where a.target_user_id = $1
       order by a.created_at desc
       limit 50`,
      [userId]
    ),
  ]);

  return {
    userId: user.id,
    email: user.email,
    displayName: user.display_name,
    telegramUsername: user.telegram_username,
    telegramUserId: user.telegram_user_id !== null ? String(user.telegram_user_id) : null,
    role: user.role,
    joinedAt: user.created_at,
    licenses: licensesResult.rows.map((r) => ({
      id: r.id,
      licenseKey: r.license_key,
      status: r.status,
      computedStatus: r.computed_status,
      tier: r.tier,
      issuedAt: r.issued_at,
      expiresAt: r.expires_at,
      hardwareId: r.hardware_id,
      lastVerifiedAt: r.last_verified_at,
    })),
    signins: signinsResult.rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      createdAt: r.created_at,
    })),
    adminActions: actionsResult.rows.map((r) => ({
      id: r.id,
      action: r.action_type,
      actorEmail: r.actor_email,
      targetLicenseId: r.target_license_id,
      details: r.details_json,
      createdAt: r.created_at,
    })),
  };
}

export interface AdminLicenseRow {
  id: string;
  licenseKey: string;
  status: string;
  computedStatus: "active" | "expiring" | "expired" | "revoked";
  tier: string;
  issuedAt: Date;
  expiresAt: Date;
  hardwareId: string | null;
  lastVerifiedAt: Date | null;
  userId: string | null;
  email: string | null;
  claimEmail: string | null;
}

export type LicenseStatusFilter = "active" | "expiring" | "expired" | "revoked";
export type ExpiresWithinFilter = "24h" | "7d" | "30d";

export interface ListLicensesOptions {
  status?: LicenseStatusFilter;
  tier?: string;
  expiresWithin?: ExpiresWithinFilter;
  page?: number;
  perPage?: number;
}

const EXPIRES_WITHIN_INTERVAL: Record<ExpiresWithinFilter, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

const LICENSE_COMPUTED_STATUS_SQL = `
  case
    when l.status = 'revoked' then 'revoked'
    when l.expires_at <= now() then 'expired'
    when l.expires_at <= now() + interval '24 hours' then 'expiring'
    else 'active'
  end
`;

/** /admin/licenses source of truth: every license (past + present), license-first (no user context required). */
export async function listAllLicenses(
  options: ListLicensesOptions = {}
): Promise<{ rows: AdminLicenseRow[]; total: number }> {
  const perPage = options.perPage ?? 50;
  const page = Math.max(1, options.page ?? 1);
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    params.push(options.status);
    conditions.push(`${LICENSE_COMPUTED_STATUS_SQL} = $${params.length}`);
  }
  if (options.tier) {
    params.push(options.tier);
    conditions.push(`l.tier = $${params.length}`);
  }
  if (options.expiresWithin) {
    conditions.push(
      `l.expires_at <= now() + interval '${EXPIRES_WITHIN_INTERVAL[options.expiresWithin]}'`
    );
  }

  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";

  const countResult = await pool.query<{ count: string }>(
    `select count(*) from licenses l ${where}`,
    params
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  params.push(perPage);
  params.push(offset);
  const result = await pool.query(
    `select l.id, l.license_key, l.status, l.tier, l.issued_at, l.expires_at,
            l.hardware_id, l.last_verified_at, l.user_id, u.email, l.claim_email,
            ${LICENSE_COMPUTED_STATUS_SQL} as computed_status
     from licenses l
     left join users u on u.id = l.user_id
     ${where}
     order by l.expires_at asc
     limit $${params.length - 1} offset $${params.length}`,
    params
  );

  return {
    total,
    rows: result.rows.map((r) => ({
      id: r.id,
      licenseKey: r.license_key,
      status: r.status,
      computedStatus: r.computed_status,
      tier: r.tier,
      issuedAt: r.issued_at,
      expiresAt: r.expires_at,
      hardwareId: r.hardware_id,
      lastVerifiedAt: r.last_verified_at,
      userId: r.user_id,
      email: r.email,
      claimEmail: r.claim_email,
    })),
  };
}

export async function listDistinctTiers(): Promise<string[]> {
  const result = await pool.query("select distinct tier from licenses order by tier");
  return result.rows.map((r) => r.tier);
}

/** Appends to the append-only signin_events log — called from the NextAuth signIn callback for every successful sign-in. */
export async function recordSigninEvent(userId: string, provider: string): Promise<void> {
  await pool.query("insert into signin_events (user_id, provider) values ($1, $2)", [userId, provider]);
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
