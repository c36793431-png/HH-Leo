import crypto from "crypto";
import { pool } from "./db";
import {
  notifyPaidActivation,
  notifyTrialIssued,
  notifyLicenseUpgraded,
  notifyLicenseRevoked,
} from "./telemetry-sink";
import { insertPayment } from "./payments";
import type { UserRole } from "./admin-user-roles";
import { maybeCreateReferralEarning } from "./referrals";
import { removeFromPaidGroup } from "./group-membership";

/** Single source of truth for the active/expiring/expired/revoked bucket shown on every
 * license row across /admin/users, /admin/users/[id], and /admin/licenses — these three
 * pages used to each define their own CASE expression and drifted (a license 24h from
 * expiry showed ACTIVE on one page, EXPIRING on another). Any page rendering license
 * status must select via this fragment, never hand-roll its own. */
function licenseStatusCaseSql(alias: string, { noneWhenMissing = false } = {}): string {
  return `
    case
      ${noneWhenMissing ? `when ${alias}.id is null then 'none'\n      ` : ""}when ${alias}.status = 'revoked' then 'revoked'
      when ${alias}.expires_at <= now() then 'expired'
      when ${alias}.expires_at <= now() + interval '24 hours' then 'expiring'
      else 'active'
    end
  `;
}

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
  /** Defaults to 30 days from now when omitted. */
  expiresAt?: Date;
  notes?: string;
  feedTypes?: FeedType[];
  /** Defaults to the DB column default ('paid') when omitted. */
  tier?: LicenseTier;
}

export interface IssuedLicense {
  id: string;
  licenseKey: string;
  expiresAt: Date;
}

/** True if this license is the user's (or pre-provisioned claim's) only currently-active
 * one — i.e. a genuine new activation rather than a renewal/re-issue landing alongside
 * (or on top of) one that's still active. issueLicense already refuses to create a second
 * active license for a known userId, so this mainly guards the claim_email/claim_telegram
 * pre-provision path, which has no such check at insert time. */
async function isFirstActiveLicense(args: {
  newLicenseId: string;
  userId?: string;
  claimEmail?: string;
  claimTelegramUserId?: number;
}): Promise<boolean> {
  if (args.userId) {
    const result = await pool.query(
      `select 1 from licenses where user_id = $1 and status = 'active' and id != $2 limit 1`,
      [args.userId, args.newLicenseId]
    );
    return (result.rowCount ?? 0) === 0;
  }
  if (args.claimEmail) {
    const result = await pool.query(
      `select 1 from licenses where claim_email = $1 and status = 'active' and id != $2 limit 1`,
      [args.claimEmail, args.newLicenseId]
    );
    return (result.rowCount ?? 0) === 0;
  }
  if (args.claimTelegramUserId !== undefined) {
    const result = await pool.query(
      `select 1 from licenses where claim_telegram_user_id = $1 and status = 'active' and id != $2 limit 1`,
      [args.claimTelegramUserId, args.newLicenseId]
    );
    return (result.rowCount ?? 0) === 0;
  }
  return true;
}

/** Thrown by issueLicense when the target user already holds an active license — product rule is one active license per user at a time. */
export class ActiveLicenseExistsError extends Error {
  constructor(public existingLicenseId: string, public expiresAt: Date) {
    super(`User already has an active license (expires ${expiresAt.toISOString()}). Revoke it before issuing a new one.`);
    this.name = "ActiveLicenseExistsError";
  }
}

/** Thrown by issueAdditionalLicense when the target user has no active license to add to — that's
 * a first activation and belongs on issueLicense (or the claim path), not here. */
export class NoActiveLicenseError extends Error {
  constructor(public userId: string) {
    super(`User has no active license. Use "Issue new license" for a first activation.`);
    this.name = "NoActiveLicenseError";
  }
}

/** Creates an active license row bound to an existing user, or pre-provisioned by claim_email/claim_telegram_user_id ahead of signup. */
export async function issueLicense(args: IssueLicenseArgs): Promise<IssuedLicense> {
  const expiresAt = args.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (args.userId) {
    const existing = await getActiveLicenseForUser(args.userId);
    if (existing) throw new ActiveLicenseExistsError(existing.id, existing.expiresAt);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const licenseKey = generateLicenseKey();
    try {
      const result = await pool.query(
        `insert into licenses (user_id, claim_email, claim_telegram_user_id, license_key, status, expires_at, notes, feed_types, tier)
         values ($1, $2, $3, $4, 'active', $5, $6, $7, coalesce($8, 'paid'))
         returning id, license_key, expires_at, tier`,
        [
          args.userId ?? null,
          args.claimEmail ?? null,
          args.claimTelegramUserId ?? null,
          licenseKey,
          expiresAt,
          args.notes ?? null,
          args.feedTypes ?? [],
          args.tier ?? null,
        ]
      );
      const row = result.rows[0];

      notifyNewPaidActivation({
        newLicenseId: row.id,
        licenseKey: row.license_key,
        tier: row.tier,
        expiresAt: row.expires_at,
        userId: args.userId,
        claimEmail: args.claimEmail,
        claimTelegramUserId: args.claimTelegramUserId,
      }).catch(() => {});

      recordAutoPaymentForNewLicense({
        newLicenseId: row.id,
        tier: row.tier,
        userId: args.userId,
        claimEmail: args.claimEmail,
        claimTelegramUserId: args.claimTelegramUserId,
      }).catch(() => {});

      return { id: row.id, licenseKey: row.license_key, expiresAt: row.expires_at };
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "23505") continue; // license_key collision — retry with a fresh key
      throw err;
    }
  }
  throw new Error("issueLicense: failed to generate a unique license key after 5 attempts");
}

export interface IssueAdditionalLicenseArgs {
  userId: string;
  /** Defaults to 30 days from now when omitted. */
  expiresAt?: Date;
  notes?: string;
  feedTypes?: FeedType[];
  /** Defaults to the DB column default ('paid') when omitted. */
  tier?: LicenseTier;
}

/** Issues a second (or Nth) active license for a user who already holds one — the
 * buy-additional-license path (one server per license; clients buy additional licenses,
 * not additional servers per license). Precondition is the inverse of issueLicense's: refuses
 * when the user has zero active licenses, since that case is a first activation and belongs on
 * issueLicense/the claim path. Unlike issueLicense, this never gates the activation notify or
 * payment row on isFirstActiveLicense — by construction it is never the first, so both must
 * always fire, or a legitimate 2nd purchase would silently record $0 revenue and send nothing. */
export async function issueAdditionalLicense(args: IssueAdditionalLicenseArgs): Promise<IssuedLicense> {
  const existing = await getActiveLicenseForUser(args.userId);
  if (!existing) throw new NoActiveLicenseError(args.userId);

  const expiresAt = args.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  for (let attempt = 0; attempt < 5; attempt++) {
    const licenseKey = generateLicenseKey();
    try {
      const result = await pool.query(
        `insert into licenses (user_id, license_key, status, expires_at, notes, feed_types, tier)
         values ($1, $2, 'active', $3, $4, $5, coalesce($6, 'paid'))
         returning id, license_key, expires_at, tier`,
        [args.userId, licenseKey, expiresAt, args.notes ?? null, args.feedTypes ?? [], args.tier ?? null]
      );
      const row = result.rows[0];

      sendActivationNotification({
        licenseKey: row.license_key,
        tier: row.tier,
        expiresAt: row.expires_at,
        userId: args.userId,
      }).catch(() => {});

      insertAutoPaymentForLicense({
        newLicenseId: row.id,
        tier: row.tier,
        userId: args.userId,
      }).catch(() => {});

      return { id: row.id, licenseKey: row.license_key, expiresAt: row.expires_at };
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "23505") continue; // license_key collision — retry with a fresh key
      throw err;
    }
  }
  throw new Error("issueAdditionalLicense: failed to generate a unique license key after 5 attempts");
}

/** Actually sends the trial-issued/paid-activation sink notify — split out from
 * notifyNewPaidActivation so issueAdditionalLicense (which is never a first activation by
 * construction) can fire it unconditionally instead of through the isFirstActiveLicense gate. */
async function sendActivationNotification(args: {
  licenseKey: string;
  tier: string;
  expiresAt: Date;
  userId?: string;
  claimEmail?: string;
}): Promise<void> {
  let email = args.claimEmail ?? null;
  if (!email && args.userId) {
    const result = await pool.query<{ email: string | null }>("select email from users where id = $1", [args.userId]);
    email = result.rows[0]?.email ?? null;
  }

  if (args.tier === "trial") {
    await notifyTrialIssued({
      email,
      licenseKey: args.licenseKey,
      issuedAt: new Date(),
      expiresAt: args.expiresAt,
    });
    return;
  }

  await notifyPaidActivation({
    email,
    licenseKey: args.licenseKey,
    activatedAt: new Date(),
    tier: args.tier,
  });
}

/** Fires the trial-issued/paid-signup sink notify, gated on this being a genuine new
 * activation (see isFirstActiveLicense) — never on a renewal or re-issue landing alongside
 * an already-active license. Best-effort: must never throw into issueLicense's caller. */
async function notifyNewPaidActivation(args: {
  newLicenseId: string;
  licenseKey: string;
  tier: string;
  expiresAt: Date;
  userId?: string;
  claimEmail?: string;
  claimTelegramUserId?: number;
}): Promise<void> {
  const isFirst = await isFirstActiveLicense(args);
  if (!isFirst) return;
  await sendActivationNotification(args);
}

/** portal_config row lets coxwell reprice without a code change; falls back to $100 if unset. */
async function getPaidTierDefaultPriceUsd(): Promise<number> {
  const result = await pool.query<{ value: unknown }>(
    "select value from portal_config where key = 'paid_tier_default_price_usd'"
  );
  const parsed = Number(result.rows[0]?.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
}

/** Actually inserts the finance payment row (and downstream referral earning) — split out
 * from recordAutoPaymentForNewLicense so issueAdditionalLicense (which is never a first
 * activation by construction) can fire it unconditionally instead of through the
 * isFirstActiveLicense gate. Still paid-tier-only: team is comped, deal is barter/non-revenue
 * (commits 9718252 / afafdd7) — that rule is unrelated to first-vs-additional and stays. */
async function insertAutoPaymentForLicense(args: {
  newLicenseId: string;
  tier: string;
  userId: string;
}): Promise<void> {
  if (args.tier !== "paid") return;

  const result = await pool.query<{ email: string | null }>("select email from users where id = $1", [args.userId]);
  const email = result.rows[0]?.email ?? null;
  if (!email) return;

  const amountUsd = await getPaidTierDefaultPriceUsd().catch(() => 100);

  const paymentId = await insertPayment({
    receivedAt: new Date(),
    amountUsd,
    currency: "USD",
    direction: "in",
    category: "customer",
    counterparty: email,
    userId: args.userId,
    memo: `Auto: Paid tier license activation ${args.newLicenseId.slice(0, 8)}`,
    createdBy: null,
  });

  await maybeCreateReferralEarning(paymentId);
}

/** Auto-logs a finance payment row when a Paid-tier license is a genuine new activation
 * (never on Trial/Team/Deal, and never on a renewal/re-issue — same isFirstActiveLicense
 * guard as notifyNewPaidActivation). Coxwell can still edit/delete the row from /admin/finance. */
async function recordAutoPaymentForNewLicense(args: {
  newLicenseId: string;
  tier: string;
  userId?: string;
  claimEmail?: string;
  claimTelegramUserId?: number;
}): Promise<void> {
  if (args.tier !== "paid" || !args.userId) return;

  const isFirst = await isFirstActiveLicense(args);
  if (!isFirst) return;

  await insertAutoPaymentForLicense({ newLicenseId: args.newLicenseId, tier: args.tier, userId: args.userId });
}

export async function extendLicense(licenseId: string, expiresAt: Date): Promise<void> {
  await pool.query(
    `update licenses set expires_at = $2, lifecycle_state = null where id = $1`,
    [licenseId, expiresAt]
  );
}

export async function expireLicenseNow(licenseId: string): Promise<void> {
  await pool.query(
    `update licenses set expires_at = now(), lifecycle_state = null where id = $1`,
    [licenseId]
  );
}

export async function getLicenseExpiresAt(licenseId: string): Promise<Date | null> {
  const result = await pool.query<{ expires_at: Date }>(
    "select expires_at from licenses where id = $1",
    [licenseId]
  );
  return result.rows[0]?.expires_at ?? null;
}

export async function revokeLicense(licenseId: string): Promise<void> {
  const result = await pool.query<{ license_key: string; tier: string; user_id: string | null; email: string | null }>(
    `update licenses l set status = 'revoked', lifecycle_state = 'expired_processed'
     from users u
     where l.id = $1 and l.user_id = u.id
     returning l.license_key, l.tier, l.user_id, u.email`,
    [licenseId]
  );
  const row = result.rows[0];
  if (!row) {
    // No matching user row (claim-pending license, never activated) — still revoke it.
    await pool.query(
      `update licenses set status = 'revoked', lifecycle_state = 'expired_processed' where id = $1`,
      [licenseId]
    );
    return;
  }

  notifyLicenseRevoked({
    email: row.email,
    licenseKey: row.license_key,
    tier: row.tier,
    revokedAt: new Date(),
  }).catch(() => {});
}

export type LicenseTier = "trial" | "paid" | "team" | "deal";
export const LICENSE_TIERS: LicenseTier[] = ["trial", "paid", "team", "deal"];

/** Paid-adjacent tiers that should land the customer in the paid Telegram group — everything
 * except trial. NOT used for revenue accounting (recordAutoPaymentForNewLicense stays paid-only:
 * team is comped and deal is barter/non-revenue, see commits 9718252 / afafdd7). */
export function isPaidTier(tier: LicenseTier | string): boolean {
  return tier === "paid" || tier === "team" || tier === "deal";
}

/** Changes an existing license's tier (e.g. trial → paid, or a plain tier bump). Fires the
 * lifecycle sink notify when the tier actually changes and the license belongs to a real
 * (non-claim-pending) user — best-effort, must never throw into the caller. */
export async function setLicenseTier(licenseId: string, tier: LicenseTier): Promise<void> {
  const current = await pool.query<{ tier: string; license_key: string; user_id: string | null }>(
    `select tier, license_key, user_id from licenses where id = $1`,
    [licenseId]
  );
  const before = current.rows[0];

  await pool.query(`update licenses set tier = $2 where id = $1`, [licenseId, tier]);

  if (before && before.tier !== tier) {
    // Keep the auto-payment row's activation_source in sync with reality — this is the durable
    // fix for the leak where tier gets reclassified post-issuance (e.g. paid -> trial/deal)
    // without ever touching the payment inserted by recordAutoPaymentForNewLicense at
    // issuance time, which is what caused the Aug 2026 finance ledger discrepancy.
    // Auto-payment rows are matched by memo (no license_id FK on payments) — see
    // recordAutoPaymentForNewLicense for the memo format this depends on.
    await pool.query(
      `update payments set activation_source = $1
       where memo = $2
       and category = 'customer'`,
      [tier, `Auto: Paid tier license activation ${licenseId.slice(0, 8)}`]
    );

    if (before.user_id) {
      const userResult = await pool.query<{ email: string | null }>(
        "select email from users where id = $1",
        [before.user_id]
      );
      notifyLicenseUpgraded({
        email: userResult.rows[0]?.email ?? null,
        licenseKey: before.license_key,
        fromTier: before.tier,
        toTier: tier,
      }).catch(() => {});
    }
  }
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

/** /v1/hft-alert resolves straight from the license key (no session), so it needs a
 * license-id -> user lookup rather than getGroupTarget's userId -> user one. Returns
 * null only if the license has no owning user yet (pre-provisioned, unclaimed). */
export async function getAlertTargetForLicense(licenseId: string): Promise<GroupTarget | null> {
  const result = await pool.query<{ user_id: string | null; telegram_user_id: string | null; email: string | null }>(
    `select u.id as user_id, u.telegram_user_id, u.email
     from licenses l
     join users u on u.id = l.user_id
     where l.id = $1`,
    [licenseId]
  );
  const row = result.rows[0];
  if (!row || !row.user_id) return null;
  return { userId: row.user_id, telegramUserId: row.telegram_user_id, email: row.email };
}

/** Single entry point for revoking a license and keeping paid-group membership in sync —
 * resolves the owner internally via getAlertTargetForLicense instead of relying on the
 * caller to pass a userId. revokeLicenseFromListAction and revokeAction never touched group
 * membership at all, and revokeLicenseAction only did when the form happened to include
 * userId; all three now go through here so correct behaviour is the default, not the lucky
 * case. Always uses removeFromPaidGroupIfNoOtherActiveLicense, never the raw
 * removeFromPaidGroup — forceRemoveGroupAction is the only deliberate-override caller of
 * that. Per marcus, thread overnight-builds-2026-08-30. */
export async function revokeLicenseAndSyncGroup(licenseId: string): Promise<void> {
  const target = await getAlertTargetForLicense(licenseId);
  await revokeLicense(licenseId);
  if (target?.telegramUserId) {
    await removeFromPaidGroupIfNoOtherActiveLicense(target.userId, target.telegramUserId);
  }
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
  id: string;
  licenseKey: string;
  expiresAt: Date;
}

export async function getActiveLicenseForUser(userId: string): Promise<ActiveLicense | null> {
  const result = await pool.query(
    `select id, license_key, expires_at from licenses
     where user_id = $1 and status = 'active' and expires_at > now()
     order by expires_at desc
     limit 1`,
    [userId]
  );
  const row = result.rows[0];
  return row ? { id: row.id, licenseKey: row.license_key, expiresAt: row.expires_at } : null;
}

/** All of a user's currently-active licenses, for surfaces that must render/act on each one
 * individually (e.g. per-license server registration) rather than collapsing to "the" license.
 * issued_at desc tiebreaks expires_at ties (e.g. two same-day purchases with equal duration) so
 * card order is stable across renders — same precedence 0007's dedup migration used. */
export async function getActiveLicensesForUser(userId: string): Promise<ActiveLicense[]> {
  const result = await pool.query(
    `select id, license_key, expires_at from licenses
     where user_id = $1 and status = 'active' and expires_at > now()
     order by expires_at desc, issued_at desc`,
    [userId]
  );
  return result.rows.map((row) => ({ id: row.id, licenseKey: row.license_key, expiresAt: row.expires_at }));
}

/** Same set/order as getActiveLicensesForUser, but with the full LicenseDetail columns —
 * for surfaces (dashboard card) that must render each active license's own tier/hwid/last-seen
 * rather than just its id/key. Kept separate from ActiveLicense so entitlement-adjacent callers
 * of getActiveLicensesForUser (issueLicense's active-license check, /account/servers) don't pick
 * up extra columns they don't need. */
export async function getActiveLicenseDetailsForUser(userId: string): Promise<LicenseDetail[]> {
  const result = await pool.query(
    `select id, license_key, status, tier, issued_at, expires_at, hardware_id, last_verified_at, feed_types
     from licenses
     where user_id = $1 and status = 'active' and expires_at > now()
     order by expires_at desc, issued_at desc`,
    [userId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    licenseKey: row.license_key,
    status: row.status,
    tier: row.tier,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    hardwareId: row.hardware_id,
    lastVerifiedAt: row.last_verified_at,
    feedTypes: (row.feed_types ?? []).filter(isFeedType),
  }));
}

/** Bug 2 (marcus, thread overnight-builds-2026-08-30): once issueAdditionalLicense lets a
 * user hold more than one active license, expiring/revoking any single one of them must not
 * evict a client who is still paying via another. Call this instead of removeFromPaidGroup
 * directly wherever a single license's lapse is the trigger (expire-licenses cron,
 * revokeLicenseAction) — but not forceRemoveGroupAction, which is a deliberate admin
 * override and must bypass this check. Logs the skip so "chose not to remove" reads
 * differently from "forgot to remove" in the logs. */
export async function removeFromPaidGroupIfNoOtherActiveLicense(
  userId: string,
  telegramUserId: string | number
): Promise<void> {
  const remaining = await getActiveLicensesForUser(userId);
  if (remaining.length > 0) {
    console.log(
      `removeFromPaidGroup skipped for user ${userId}: ${remaining.length} other active license(s) remain`
    );
    return;
  }
  await removeFromPaidGroup(userId, telegramUserId);
}

export interface VerifyLicenseResult {
  status: "active" | "expired" | "revoked" | "not_found";
  expiresAt: Date | null;
  licenseId: string | null;
}

/** Canonical /api/verify-license lookup — also stamps last_verified_at for phone-home telemetry. */
export async function verifyLicenseKey(licenseKey: string): Promise<VerifyLicenseResult> {
  const result = await pool.query(
    `update licenses set last_verified_at = now()
     where license_key = $1
     returning id, status, expires_at`,
    [licenseKey]
  );
  const row = result.rows[0];
  if (!row) return { status: "not_found", expiresAt: null, licenseId: null };
  if (row.status === "revoked") return { status: "revoked", expiresAt: row.expires_at, licenseId: row.id };
  if (new Date(row.expires_at) <= new Date())
    return { status: "expired", expiresAt: row.expires_at, licenseId: row.id };
  return { status: "active", expiresAt: row.expires_at, licenseId: row.id };
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
  issuedAt: Date;
  expiresAt: Date;
  hardwareId: string | null;
  lastVerifiedAt: Date | null;
  feedTypes: FeedType[];
}

export type LicenseDisplayStatus = "active" | "expiring" | "expired" | "revoked" | "none";

/** JS mirror of licenseStatusCaseSql, for pages that already hold a license row (dashboard
 * card, banner) instead of querying — keep the 24h "expiring" threshold in sync with that
 * SQL fragment if it ever changes. */
export function computeLicenseDisplayStatus(
  license: { status: string; expiresAt: Date } | null,
  now: Date = new Date()
): LicenseDisplayStatus {
  if (!license) return "none";
  if (license.status === "revoked") return "revoked";
  const msRemaining = license.expiresAt.getTime() - now.getTime();
  if (msRemaining <= 0) return "expired";
  if (msRemaining <= 24 * 60 * 60 * 1000) return "expiring";
  return "active";
}

/** Sidebar/account nav tier bucket for the signed-in user — folds 'deal' into 'paid'
 * (no dedicated nav slot for it) and any non-active license into 'free'. Kept as its
 * own string union rather than importing PortalTier from the sidebar component to
 * avoid pulling a "use client" module into this server-only file. */
export function computePortalTier(
  isAdmin: boolean,
  license: { tier: string; status: string; expiresAt: Date } | null
): "free" | "trial" | "paid" | "team" | "admin" {
  if (isAdmin) return "admin";
  const status = computeLicenseDisplayStatus(license);
  if (status !== "active" && status !== "expiring") return "free";
  if (license!.tier === "team") return "team";
  if (license!.tier === "trial") return "trial";
  return "paid";
}

/** Dashboard widget lookup — unlike getActiveLicenseForUser, returns the latest license regardless of status/expiry so the UI can render EXPIRED/REVOKED states. */
export async function getLicenseForUser(userId: string): Promise<LicenseDetail | null> {
  const result = await pool.query(
    `select id, license_key, status, tier, issued_at, expires_at, hardware_id, last_verified_at, feed_types
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
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    hardwareId: row.hardware_id,
    lastVerifiedAt: row.last_verified_at,
    feedTypes: (row.feed_types ?? []).filter(isFeedType),
  };
}

export interface AdminUserRow {
  userId: string;
  email: string | null;
  displayName: string | null;
  telegramUsername: string | null;
  role: string;
  joinedAt: Date;
  signupSource: "telegram" | "email-link" | "both" | null;
  licenseId: string | null;
  licenseKey: string | null;
  status: string | null;
  computedStatus: "active" | "expiring" | "expired" | "revoked" | "none";
  expiresAt: Date | null;
  tier: string | null;
  hardwareId: string | null;
  lastVerifiedAt: Date | null;
  feedTypes: FeedType[];
}

export type HasLicenseFilter = "active" | "expiring" | "expired" | "revoked" | "none";
export type SignupSourceFilter = "telegram" | "email-link" | "both";
export type RoleFilter = UserRole;
export type UsersSortColumn = "joined_at" | "last_verified_at" | "expires_at";
export type SortDir = "asc" | "desc";

/** Segmented tab bucket for /admin/users: admin/free by role+license state, the rest by active tier. */
export type UsersTierBucket = "free" | "trial" | "paid" | "team" | "deal" | "admin";
export const USERS_TIER_BUCKETS: UsersTierBucket[] = ["free", "trial", "paid", "team", "deal", "admin"];

export interface ListUsersOptions {
  search?: string;
  hasLicense?: HasLicenseFilter;
  signupSource?: SignupSourceFilter;
  role?: RoleFilter;
  tierBucket?: UsersTierBucket;
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

const COMPUTED_STATUS_SQL = licenseStatusCaseSql("l", { noneWhenMissing: true });

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
  if (options.role) {
    params.push(options.role);
    conditions.push(`u.role = $${params.length}`);
  }
  if (options.tierBucket === "admin") {
    conditions.push(`u.role = 'admin'`);
  } else if (options.tierBucket === "free") {
    conditions.push(`u.role != 'admin' and ${COMPUTED_STATUS_SQL} not in ('active', 'expiring')`);
  } else if (options.tierBucket) {
    params.push(options.tierBucket);
    conditions.push(
      `u.role != 'admin' and ${COMPUTED_STATUS_SQL} in ('active', 'expiring') and l.tier = $${params.length}`
    );
  }

  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";

  const baseFrom = `
    from users u
    left join lateral (
      select id, license_key, status, expires_at, tier, hardware_id, last_verified_at, feed_types
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
    `select u.id as user_id, u.email, u.display_name, u.telegram_username, u.role, u.created_at,
            ${SIGNUP_SOURCE_SQL} as signup_source,
            l.id as license_id, l.license_key, l.status, l.expires_at, l.tier,
            l.hardware_id, l.last_verified_at, l.feed_types,
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
      role: r.role,
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
      feedTypes: (r.feed_types ?? []).filter(isFeedType),
    })),
  };
}

export interface UserLicenseRow {
  id: string;
  licenseKey: string;
  status: string;
  computedStatus: "active" | "expiring" | "expired" | "revoked";
  lifecycleState: string | null;
  tier: string;
  issuedAt: Date;
  expiresAt: Date;
  hardwareId: string | null;
  lastVerifiedAt: Date | null;
  feedTypes: FeedType[];
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

export interface UserGroupMembershipRow {
  id: string;
  chatId: string;
  status: string;
  invitedAt: Date;
  joinedAt: Date | null;
  removedAt: Date | null;
}

export type UserTierLabel = "Paid" | "Trial" | "Team" | "Deal" | "No Active License" | "Admin";

export interface UserDetail {
  userId: string;
  email: string | null;
  displayName: string | null;
  telegramUsername: string | null;
  telegramUserId: string | null;
  telegramBotStartedAt: Date | null;
  role: string;
  joinedAt: Date;
  tierLabel: UserTierLabel;
  licenses: UserLicenseRow[];
  signins: SigninEventRow[];
  adminActions: UserDetailAdminActionRow[];
  groupMemberships: UserGroupMembershipRow[];
  activeIp: string | null;
  adminNotes: string | null;
  notesLastEditedBy: string | null;
  notesLastEditedAt: Date | null;
}

/** Same active-tier-or-Free/Admin bucketing as getRecentSignups' statusLabel, but also
 * distinguishes admin accounts (role='admin' — never carries a customer license). */
function computeTierLabel(role: string, activeTier: string | null): UserTierLabel {
  if (role === "admin") return "Admin";
  switch (activeTier) {
    case "paid":
      return "Paid";
    case "trial":
      return "Trial";
    case "team":
      return "Team";
    case "deal":
      return "Deal";
    default:
      return "No Active License";
  }
}

/** /admin/users/[id] source of truth: full profile, every license (past + present), signin
 * history, admin actions taken against them, Telegram group memberships, and tier badge. */
export async function getUserDetail(userId: string): Promise<UserDetail | null> {
  const userResult = await pool.query(
    `select id, email, display_name, telegram_username, telegram_user_id, telegram_bot_started_at, role, created_at, admin_notes, active_ip
     from users where id = $1`,
    [userId]
  );
  const user = userResult.rows[0];
  if (!user) return null;

  const [licensesResult, signinsResult, actionsResult, groupsResult] = await Promise.all([
    pool.query(
      `select id, license_key, status, lifecycle_state, tier, issued_at, expires_at, hardware_id, last_verified_at, feed_types,
              ${licenseStatusCaseSql("licenses")} as computed_status
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
    pool.query(
      `select id, chat_id, status, invited_at, joined_at, removed_at
       from group_memberships where user_id = $1 and tier = 'paid'
       order by invited_at desc`,
      [userId]
    ),
  ]);

  const activeTier = licensesResult.rows.find(
    (r) => r.computed_status === "active" || r.computed_status === "expiring"
  )?.tier as string | undefined;

  const lastNoteEdit = actionsResult.rows.find((r) => r.action_type === "admin_users_update_notes");

  return {
    userId: user.id,
    email: user.email,
    displayName: user.display_name,
    telegramUsername: user.telegram_username,
    telegramUserId: user.telegram_user_id !== null ? String(user.telegram_user_id) : null,
    telegramBotStartedAt: user.telegram_bot_started_at,
    role: user.role,
    joinedAt: user.created_at,
    tierLabel: computeTierLabel(user.role, activeTier ?? null),
    licenses: licensesResult.rows.map((r) => ({
      id: r.id,
      licenseKey: r.license_key,
      status: r.status,
      computedStatus: r.computed_status,
      lifecycleState: r.lifecycle_state,
      tier: r.tier,
      issuedAt: r.issued_at,
      expiresAt: r.expires_at,
      hardwareId: r.hardware_id,
      lastVerifiedAt: r.last_verified_at,
      feedTypes: (r.feed_types ?? []).filter(isFeedType),
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
    groupMemberships: groupsResult.rows.map((r) => ({
      id: r.id,
      chatId: String(r.chat_id),
      status: r.status,
      invitedAt: r.invited_at,
      joinedAt: r.joined_at,
      removedAt: r.removed_at,
    })),
    activeIp: user.active_ip,
    adminNotes: user.admin_notes,
    notesLastEditedBy: lastNoteEdit?.actor_email ?? null,
    notesLastEditedAt: lastNoteEdit?.created_at ?? null,
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

const LICENSE_COMPUTED_STATUS_SQL = licenseStatusCaseSql("l");

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

export type FeedType = "futures" | "london" | "ny" | "crypto";
export const FEED_TYPES: FeedType[] = ["futures", "london", "ny", "crypto"];

export interface FeedTypeMeta {
  id: FeedType;
  name: string;
  description: string;
  /** Short co-lo code shown as a compact badge (e.g. on /strategies cards) — matches the
   * vocabulary already spelled out in `description` so the two stay consistent. */
  coloCode: string;
}

// text[] column (not enum) — new feed types append here without a schema change.
export const FEED_TYPE_META: Record<FeedType, FeedTypeMeta> = {
  futures: { id: "futures", name: "CME Futures Feed", description: "Chicago · CH1 co-lo — CME Group futures, indices, metals & energy", coloCode: "CH1" },
  london: { id: "london", name: "London Feed", description: "London · LD4 co-lo — European ECN aggregator, FX, gold & indices", coloCode: "LD4" },
  ny: { id: "ny", name: "New York Feed", description: "New York · NY4 co-lo — Institutional FX aggregator, majors, metals & US indices", coloCode: "NY4" },
  crypto: { id: "crypto", name: "Crypto Tokyo Feed", description: "Tokyo · TY3 co-lo — Institutional crypto aggregator, spot & perpetual futures", coloCode: "TY3" },
};

function isFeedType(value: string): value is FeedType {
  return (FEED_TYPES as string[]).includes(value);
}

export async function setLicenseFeedTypes(licenseId: string, feedTypes: FeedType[]): Promise<void> {
  await pool.query(`update licenses set feed_types = $2 where id = $1`, [licenseId, feedTypes]);
}

/** Feeds live and die with the license they're attached to — active feeds are the union
 * of feed_types across every currently-active license a user holds (a user can hold more
 * than one, e.g. via claimPendingLicense claiming multiple pre-provisioned licenses at
 * once), empty when there's none. */
export async function computeUserActiveFeeds(userId: string): Promise<FeedType[]> {
  const result = await pool.query<{ feed_types: string[] }>(
    `select feed_types from licenses
     where user_id = $1 and status = 'active' and expires_at > now()`,
    [userId]
  );
  const raw = result.rows.flatMap((r) => r.feed_types ?? []);
  return [...new Set(raw.filter(isFeedType))];
}

/** Sum of monthly_cost_usd across every feed_type entitlement on every currently-active
 * license — the real per-feed provider cost, not a manual payments-ledger entry. Powers
 * the admin dashboard Costs stat tile. */
export async function getFeedCostStats(): Promise<{ totalMonthlyCost: number; activeLicenseCount: number }> {
  const result = await pool.query<{ total: string; active_license_count: string }>(
    `select
       coalesce(sum(fd.monthly_cost_usd), 0) as total,
       count(distinct l.id) filter (where fd.feed_type is not null) as active_license_count
     from licenses l
     left join lateral unnest(l.feed_types) as ft(feed_type) on true
     left join feed_definitions fd on fd.feed_type = ft.feed_type
     where l.status = 'active' and l.expires_at > now()`
  );
  const row = result.rows[0];
  return {
    totalMonthlyCost: Number(row?.total ?? 0),
    activeLicenseCount: Number(row?.active_license_count ?? 0),
  };
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
