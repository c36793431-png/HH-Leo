import type { PoolClient } from "@neondatabase/serverless";
import { pool, type Db } from "./db";
import {
  bundleByKey,
  bundleFeedTierKeys,
  bundleFeedType,
  isBundleFeedChoice,
  type BundleFeedChoice,
  type BundleKey,
} from "./bundle-catalogue";
import {
  extendLicenseOn,
  getAlertTargetForLicense,
  issueLicenseOn,
  licenseNumberSql,
  removeFromPaidGroupIfNoOtherActiveLicense,
  revokeLicenseOn,
  sendActivationNotification,
  setLicenseTierOn,
  type RevokedLicenseRow,
} from "./licenses";
import { insertPaymentOn, isReceivableUsdAmount } from "./payments";
import { maybeCreateReferralEarning } from "./referrals";
import { notifyLicenseRevoked, notifyLicenseUpgraded } from "./telemetry-sink";
import { clientRefForUser } from "./client-ref";
import {
  DuplicateTierGrantError,
  EFFECTIVE_STATUS_SQL,
  FeedTierNotAssignedError,
  NoServerForFeedGrantError,
  assignPseudonymSeq,
  createSubscription,
  insertAllowlistRecord,
  isUniqueViolation,
  lockServerRegistration,
} from "./feed-subscriptions";

/** Horizon Complete bundle lifecycle, slice 1 (plan m66837-9 + folds m66997/m67030/m67035, Fable combined
 * verdict m67049, GO marcus m67050). Every path runs ONE transaction on ONE client, and the variants it calls
 * schedule nothing (plan 5a B3); each path sends its own notify AFTER commit, awaited, so a rolled-back
 * activation can never have notified anyone and nothing is left running when a Vercel invocation ends.
 *
 * ONE CLOCK: the bundle's licence. A stamped feed row is live only while that licence is active and unexpired
 * (EFFECTIVE_STATUS_SQL's licence branch), so Renew = extend the licence, and expiry lapses the feeds with no
 * write. The vendor allowlist does NOT follow that clock, which is why End writes revoked_at on it. */

/** portal_config key: the feed share written into price_cents on every stamped member row of a PAID bundle,
 * as {"ld-base": <cents>, "ny-base": <cents>}. WAITS ON coxwell Q-F (marcus proposal 3000, so the provider's
 * 50% is $15). No fallback: a missing or bad value refuses the grant (BundleFeedShareUnsetError). */
export const BUNDLE_FEED_SHARE_CONFIG_KEY = "bundle_feed_share_cents";

/** A trial bundle's stamped rows carry 0 explicitly, never NULL or the list price (5d-2 C10): the provider's
 * payout read then reads 0 for them. */
const TRIAL_FEED_SHARE_CENTS = 0;

const MAX_TERM_DAYS = 366;

export type BundleEndMode = "cancel" | "unbundle";

export class BundleAlreadyActiveError extends Error {
  constructor() {
    super("This client already has an active Horizon Complete bundle -- Renew it instead (one bundle per client in v1)");
    this.name = "BundleAlreadyActiveError";
  }
}

export class BundleLicencePickRequiredError extends Error {
  constructor(public licences: { id: string; licenseNumber: number }[]) {
    super(
      `This client holds ${licences.length} active licences (${licences.map((l) => `HH${l.licenseNumber}`).join(", ")}) -- pick the one that carries the bundle`
    );
    this.name = "BundleLicencePickRequiredError";
  }
}

export class BundleTrialNeedsNoLicenceError extends Error {
  constructor() {
    super("A trial bundle needs a client with no active licence: adopting one would extend it for free (plan 4c Q-B)");
    this.name = "BundleTrialNeedsNoLicenceError";
  }
}

export class BundleNotActiveError extends Error {
  constructor() {
    super("This bundle is not active");
    this.name = "BundleNotActiveError";
  }
}

export class BundleLicenceNotLiveError extends Error {
  constructor(licenseNumber: number) {
    super(`HH${licenseNumber} is past expiry or revoked, so the bundle's feed can't be granted -- Renew first`);
    this.name = "BundleLicenceNotLiveError";
  }
}

/** Renew can't revive a revoked licence: nothing un-revokes one (fold m66997 N1, ruled m67000). */
export class LicenceRevokedError extends Error {
  constructor(licenseNumber: number) {
    super(`HH${licenseNumber} is revoked, and nothing un-revokes a licence -- End the bundle; a returning client gets a fresh activation`);
    this.name = "LicenceRevokedError";
  }
}

export class BundleFeedShareUnsetError extends Error {
  constructor(choice: BundleFeedChoice) {
    super(
      `portal_config ${BUNDLE_FEED_SHARE_CONFIG_KEY} has no positive whole-cent share for ${choice}, so the bundle's feed rows can't be priced -- set it first (no fallback to the list price)`
    );
    this.name = "BundleFeedShareUnsetError";
  }
}

export class BundleCancelRefusedError extends Error {
  constructor(why: string) {
    super(`Cancel would revoke the licence, which ${why} -- use Unbundle instead`);
    this.name = "BundleCancelRefusedError";
  }
}

/** Trial -> paid conversion of a bundle is not specified in the plan; refused rather than invented. */
export class BundleTrialRenewError extends Error {
  constructor() {
    super("A trial bundle can't be renewed: converting a trial bundle to paid is not built yet");
    this.name = "BundleTrialRenewError";
  }
}

function assertTermDays(termDays: number): void {
  if (!Number.isInteger(termDays) || termDays < 1 || termDays > MAX_TERM_DAYS) {
    throw new Error(`Term must be a whole number of days from 1 to ${MAX_TERM_DAYS}`);
  }
}

function assertAmount(amountUsd: number): void {
  if (!isReceivableUsdAmount(amountUsd)) throw new Error("Amount received must be a dollar amount above 0, like 100 or 99.50");
}

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/** After-commit side effects never throw into the caller: the writes are already committed. Awaited. */
async function afterCommit(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`bundles: after-commit ${label} failed`, (err as Error)?.message);
  }
}

interface LockedBundle {
  id: string;
  user_id: string;
  bundle_key: BundleKey;
  feed_choice: BundleFeedChoice;
  license_id: string;
  status: "active" | "ended";
  is_trial: boolean;
  license_adopted: boolean;
}

async function lockBundle(db: Db, bundleId: string): Promise<LockedBundle> {
  const r = await db.query<LockedBundle>(
    `select id, user_id, bundle_key, feed_choice, license_id, status, is_trial, license_adopted
     from bundle_subscriptions where id = $1 for update`,
    [bundleId]
  );
  if (!r.rows[0] || r.rows[0].status !== "active") throw new BundleNotActiveError();
  return r.rows[0];
}

interface LockedLicence {
  id: string;
  status: string;
  tier: string;
  expires_at: Date;
  live: boolean;
  license_number: number;
}

async function lockLicence(db: Db, licenseId: string): Promise<LockedLicence> {
  const r = await db.query<LockedLicence>(
    `select id, status, tier, expires_at, (status = 'active' and expires_at > now()) as live,
            ${licenseNumberSql("licenses")}::int as license_number
     from licenses where id = $1 for update`,
    [licenseId]
  );
  if (!r.rows[0]) throw new Error("Bundle licence not found");
  return r.rows[0];
}

async function feedShareCents(db: Db, choice: BundleFeedChoice): Promise<number> {
  const r = await db.query<{ value: unknown }>(`select value from portal_config where key = $1`, [BUNDLE_FEED_SHARE_CONFIG_KEY]);
  const value = r.rows[0]?.value;
  const cents = value && typeof value === "object" ? (value as Record<string, unknown>)[choice] : undefined;
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents <= 0) throw new BundleFeedShareUnsetError(choice);
  return cents;
}

export interface BundleFeedRow {
  tierKey: string;
  subscriptionId: string;
}

export interface BundleFeedGrantResult {
  serverName: string;
  declaredIp: string;
  /** Rows this bundle now stamps, with what happened to each. */
  stamped: (BundleFeedRow & { outcome: "created" | "reactivated" | "repointed" | "refreshed" })[];
  /** Live rows the client already held separately on this server: left alone, never stamped, so End never
   * reaches them (Fable 5a S1). Each still gets named at the confirm step and on the admin card (slice 3). */
  covered: BundleFeedRow[];
}

/** grantBundleFeed's body on the caller's transaction (activate and renew call it inside theirs).
 * The licence comes ONLY from the bundle row, never from getActiveLicensesForUser, which refuses 2+ licences
 * (5a B2a). For each member tier, on the (server, tier) business key assign uses:
 * - a live row the client holds separately -> covered: no stamp, no UPDATE;
 * - a lapsed row, or a live row this bundle already stamps -> reactivated/refreshed and stamped;
 * - no row -> created and stamped.
 * Every stamped row gets ends_at = the licence's expires_at (display only), the feed share as price_cents,
 * and its allowlist record. Any member without a provider rolls the whole grant back. */
async function grantBundleFeedOn(client: PoolClient, bundle: LockedBundle, licence: LockedLicence): Promise<BundleFeedGrantResult> {
  if (!licence.live) throw new BundleLicenceNotLiveError(licence.license_number);

  const tierKeys = bundleFeedTierKeys(bundle.feed_choice);
  const tiers = await client.query<{ id: string; tier_key: string; name: string; region_key: string; provider_user_id: string | null }>(
    `select id, tier_key, name, region_key, provider_user_id from feed_tiers where tier_key = any($1)`,
    [tierKeys]
  );
  for (const key of tierKeys) {
    const t = tiers.rows.find((r) => r.tier_key === key);
    if (!t) throw new Error(`Unknown feed tier: ${key}`);
    if (!t.provider_user_id) throw new FeedTierNotAssignedError(t.name, t.region_key);
  }

  const server = await client.query<{ id: string }>(`select id from server_registrations where license_id = $1`, [licence.id]);
  if (!server.rowCount) throw new NoServerForFeedGrantError("the Horizon Complete feed", licence.license_number);
  const sr = await lockServerRegistration(client, server.rows[0].id);
  if (!sr) throw new NoServerForFeedGrantError("the Horizon Complete feed", licence.license_number);

  const priceCents = bundle.is_trial ? TRIAL_FEED_SHARE_CENTS : await feedShareCents(client, bundle.feed_choice);
  const result: BundleFeedGrantResult = { serverName: sr.serverName, declaredIp: sr.declaredIp, stamped: [], covered: [] };

  for (const key of tierKeys) {
    const t = tiers.rows.find((r) => r.tier_key === key)!;
    const providerUserId = t.provider_user_id!;
    const existing = await client.query<{ id: string; provider_user_id: string; status: string; bundle_subscription_id: string | null }>(
      `select id, provider_user_id, status, bundle_subscription_id from feed_subscriptions
       where server_registration_id = $1 and feed_tier_id = $2
       order by (status = 'lapsed'), created_at desc
       limit 1`,
      [sr.id, t.id]
    );
    const row = existing.rows[0];

    if (row && row.status !== "lapsed" && row.bundle_subscription_id !== bundle.id) {
      if (row.bundle_subscription_id == null) {
        result.covered.push({ tierKey: key, subscriptionId: row.id });
        continue;
      }
      // Unreachable while one bundle per client holds (0107 user index) and End lapses its rows.
      throw new Error(`${t.name} is live under a different bundle on this server`);
    }

    let subscriptionId: string;
    let outcome: BundleFeedGrantResult["stamped"][number]["outcome"];
    if (row) {
      subscriptionId = row.id;
      const repoint = row.provider_user_id !== providerUserId;
      if (repoint) await assignPseudonymSeq(client, providerUserId, bundle.user_id);
      outcome = row.status !== "lapsed" ? "refreshed" : repoint ? "repointed" : "reactivated";
      await client.query(
        `update feed_subscriptions
         set provider_user_id = $2, status = 'active', lapsed_at = null, ends_at = $3,
             bundle_subscription_id = $4, price_cents = $5, updated_at = now()
         where id = $1`,
        [row.id, providerUserId, licence.expires_at, bundle.id, priceCents]
      );
    } else {
      outcome = "created";
      try {
        subscriptionId = await createSubscription(
          {
            providerUserId,
            subscriberUserId: bundle.user_id,
            licenseId: licence.id,
            serverRegistrationId: sr.id,
            endsAt: licence.expires_at,
            feedTierId: t.id,
            status: "active",
          },
          client
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw new DuplicateTierGrantError(t.name);
        throw err;
      }
      await client.query(`update feed_subscriptions set bundle_subscription_id = $2, price_cents = $3 where id = $1`, [
        subscriptionId,
        bundle.id,
        priceCents,
      ]);
    }
    await insertAllowlistRecord(client, { serverRegistrationId: sr.id, feedTierId: t.id, ip: sr.declaredIp });
    result.stamped.push({ tierKey: key, subscriptionId, outcome });
  }
  return result;
}

/** The admin's "Grant feed" (enabled once the bundle licence has a server): the second moment of an
 * activation, and the Re-grant for a covered row that has since lapsed (fold m66997 N2). */
export async function grantBundleFeed(bundleId: string): Promise<BundleFeedGrantResult> {
  return inTransaction(async (client) => {
    const bundle = await lockBundle(client, bundleId);
    const licence = await lockLicence(client, bundle.license_id);
    return grantBundleFeedOn(client, bundle, licence);
  });
}

export interface ActivateBundleArgs {
  actorUserId: string;
  userId: string;
  bundleKey: BundleKey;
  feedChoice: BundleFeedChoice;
  /** Days added to the licence clock (a new licence: from now; an adopted one: from its current expiry). */
  termDays: number;
  /** Coxwell decides at Activate (Q-B, m66858). A trial needs a client with no active licence and writes no payment. */
  isTrial: boolean;
  /** The amount actually received (Q-G: typed, no pro-rata in code). Required for a paid bundle, absent for a trial. */
  amountUsd: number | null;
  receivedAt?: Date;
  /** The licence that carries the bundle, required when the client holds 2+ active licences. */
  licenseId?: string | null;
  basketRequestId?: string | null;
}

export interface ActivateBundleResult {
  bundleId: string;
  licenseId: string;
  licenseNumber: number;
  outcome: "new-licence" | "adopted-paid" | "adopted-trial";
  paymentId: string | null;
  /** null when the licence has no server yet: the feed waits for one (plan F3). */
  feed: BundleFeedGrantResult | null;
}

/** ONE transaction: the licence (issued, or adopted and extended), the bundle row, the ONE 'bundle' payment and,
 * when the licence already has a server, the feed grant. No auto list-price payment on any path (5a B3).
 * After commit, exactly one notify per path: new licence -> activation; adopted trial -> upgraded; adopted paid
 * -> none. Then the referral hook: a plain referrer earns on the gross payment, a partner-linked one books it into
 * their partner_deals row (REFERRAL_CATEGORIES in referrals.ts decides which categories earn). */
export async function activateBundle(args: ActivateBundleArgs): Promise<ActivateBundleResult> {
  const bundleDef = bundleByKey(args.bundleKey);
  if (!bundleDef) throw new Error(`Unknown bundle: ${args.bundleKey}`);
  if (!isBundleFeedChoice(args.feedChoice) || !bundleDef.feedChoices.includes(args.feedChoice)) {
    throw new Error(`Unknown feed choice for ${bundleDef.title}: ${args.feedChoice}`);
  }
  assertTermDays(args.termDays);
  if (args.isTrial) {
    if (args.amountUsd != null) throw new Error("A trial bundle records no payment");
  } else {
    if (args.amountUsd == null) throw new Error("A paid bundle needs the amount received");
    assertAmount(args.amountUsd);
  }
  const feedType = bundleFeedType(args.feedChoice);
  const termMs = args.termDays * 24 * 60 * 60 * 1000;

  const done = await inTransaction(async (client) => {
    const user = await client.query<{ email: string | null }>(`select email from users where id = $1 for update`, [args.userId]);
    if (!user.rows[0]) throw new Error("User not found");
    const activeBundle = await client.query(`select 1 from bundle_subscriptions where user_id = $1 and status = 'active'`, [args.userId]);
    if (activeBundle.rowCount) throw new BundleAlreadyActiveError();

    const live = await client.query<{ id: string; tier: string; license_key: string; expires_at: Date; license_number: number }>(
      `select id, tier, license_key, expires_at, ${licenseNumberSql("licenses")}::int as license_number
       from licenses where user_id = $1 and status = 'active' and expires_at > now()
       order by expires_at desc, issued_at desc
       for update`,
      [args.userId]
    );

    let licenseId: string;
    let licenseNumber: number;
    let outcome: ActivateBundleResult["outcome"];
    let newLicence: { licenseKey: string; tier: string; expiresAt: Date } | null = null;
    let upgradedFrom: { tier: string; licenseKey: string } | null = null;

    if (live.rows.length === 0) {
      const issued = await issueLicenseOn(client, {
        userId: args.userId,
        expiresAt: new Date(Date.now() + termMs),
        feedTypes: [feedType],
        tier: args.isTrial ? "trial" : bundleDef.licenceTier,
        notes: `${bundleDef.title} (${args.feedChoice})`,
      });
      licenseId = issued.id;
      licenseNumber = issued.licenseNumber;
      outcome = "new-licence";
      newLicence = { licenseKey: issued.licenseKey, tier: issued.tier, expiresAt: issued.expiresAt };
    } else {
      if (args.isTrial) throw new BundleTrialNeedsNoLicenceError();
      let picked = live.rows[0];
      if (args.licenseId) {
        const match = live.rows.find((l) => l.id === args.licenseId);
        if (!match) throw new Error("The picked licence is not one of this client's active licences");
        picked = match;
      } else if (live.rows.length > 1) {
        throw new BundleLicencePickRequiredError(live.rows.map((l) => ({ id: l.id, licenseNumber: Number(l.license_number) })));
      }
      licenseId = picked.id;
      licenseNumber = Number(picked.license_number);
      await extendLicenseOn(client, licenseId, new Date(new Date(picked.expires_at).getTime() + termMs));
      await client.query(
        `update licenses set feed_types = array_append(feed_types, $2) where id = $1 and not ($2 = any(feed_types))`,
        [licenseId, feedType]
      );
      if (picked.tier === "trial") {
        await setLicenseTierOn(client, licenseId, bundleDef.licenceTier);
        upgradedFrom = { tier: picked.tier, licenseKey: picked.license_key };
        outcome = "adopted-trial";
      } else {
        outcome = "adopted-paid";
      }
    }

    const inserted = await client.query<{ id: string }>(
      `insert into bundle_subscriptions
         (user_id, bundle_key, feed_choice, license_id, basket_request_id, status, is_trial, license_adopted, activated_by)
       values ($1, $2, $3, $4, $5, 'active', $6, $7, $8)
       returning id`,
      [args.userId, args.bundleKey, args.feedChoice, licenseId, args.basketRequestId ?? null, args.isTrial, outcome !== "new-licence", args.actorUserId]
    );
    const bundleId = inserted.rows[0].id;

    const paymentId = args.isTrial
      ? null
      : await insertPaymentOn(client, {
          receivedAt: args.receivedAt ?? new Date(),
          amountUsd: args.amountUsd!,
          currency: "USD",
          direction: "in",
          category: "bundle",
          counterparty: user.rows[0].email,
          userId: args.userId,
          memo: `Bundle: ${bundleDef.title} (${args.feedChoice}) activation ${bundleId.slice(0, 8)}`,
          createdBy: args.actorUserId,
          bundleSubscriptionId: bundleId,
        });

    const hasServer = await client.query(`select 1 from server_registrations where license_id = $1`, [licenseId]);
    let feed: BundleFeedGrantResult | null = null;
    if (hasServer.rowCount) {
      const bundle = await lockBundle(client, bundleId);
      feed = await grantBundleFeedOn(client, bundle, await lockLicence(client, licenseId));
    }

    return { bundleId, licenseId, licenseNumber, outcome, paymentId, feed, newLicence, upgradedFrom };
  });

  if (done.newLicence) {
    const n = done.newLicence;
    await afterCommit("activation notify", () =>
      sendActivationNotification({ licenseKey: n.licenseKey, tier: n.tier, expiresAt: n.expiresAt, userId: args.userId })
    );
  } else if (done.upgradedFrom) {
    const u = done.upgradedFrom;
    await afterCommit("upgraded notify", async () =>
      notifyLicenseUpgraded({ client: await clientRefForUser(args.userId), licenseKey: u.licenseKey, fromTier: u.tier, toTier: bundleDef.licenceTier })
    );
  }
  if (done.paymentId) {
    const paymentId = done.paymentId;
    await afterCommit("referral hook", () => maybeCreateReferralEarning(paymentId));
  }

  return {
    bundleId: done.bundleId,
    licenseId: done.licenseId,
    licenseNumber: done.licenseNumber,
    outcome: done.outcome,
    paymentId: done.paymentId,
    feed: done.feed,
  };
}

export interface EndBundleArgs {
  actorUserId: string;
  bundleId: string;
  mode: BundleEndMode;
  reason?: string | null;
}

export interface EndBundleResult {
  lapsedRows: number;
  allowlistRevoked: number;
  licenceRevoked: boolean;
}

/** ONE transaction (5a B2b):
 * - 'cancel' revokes the licence, and is right only for a licence the bundle issued: it refuses when the
 *   licence was adopted, or when any live row on the licence is not this bundle's (revoking would lapse it
 *   through the licence clock). Then one revoked notify + the paid-group check, after commit.
 * - 'unbundle' leaves the licence active with its extended expiry, and notifies no client.
 * Both lapse ONLY the rows stamped with this bundle and revoke their open allowlist records
 * (revoked_by 'bundle-end'), skipping any (server, tier) another live row still needs. */
export async function endBundle(args: EndBundleArgs): Promise<EndBundleResult> {
  if (args.mode !== "cancel" && args.mode !== "unbundle") throw new Error(`Unknown end mode: ${args.mode}`);

  const done = await inTransaction(async (client) => {
    const bundle = await lockBundle(client, args.bundleId);
    let revoked: RevokedLicenseRow | null = null;

    if (args.mode === "cancel") {
      if (bundle.license_adopted) throw new BundleCancelRefusedError("the client held before this bundle");
      const others = await client.query<{ name: string | null }>(
        `select ft.name
         from feed_subscriptions s
         left join feed_tiers ft on ft.id = s.feed_tier_id
         where s.license_id = $1
           and s.bundle_subscription_id is distinct from $2
           and (${EFFECTIVE_STATUS_SQL}) <> 'lapsed'`,
        [bundle.license_id, bundle.id]
      );
      if (others.rowCount) {
        throw new BundleCancelRefusedError(
          `also carries ${others.rows.map((r) => r.name ?? "a provider tier").join(", ")} outside the bundle`
        );
      }
      await lockLicence(client, bundle.license_id);
      revoked = await revokeLicenseOn(client, bundle.license_id);
    }

    const allow = await client.query(
      `update feed_allowlist_records a
       set revoked_at = now(), revoked_by = 'bundle-end'
       where a.revoked_at is null
         and exists (
           select 1 from feed_subscriptions s
           where s.bundle_subscription_id = $1
             and s.server_registration_id = a.server_registration_id and s.feed_tier_id = a.feed_tier_id
         )
         and not exists (
           select 1 from feed_subscriptions o
           where o.server_registration_id = a.server_registration_id and o.feed_tier_id = a.feed_tier_id
             and o.status <> 'lapsed' and o.bundle_subscription_id is distinct from $1
         )`,
      [bundle.id]
    );
    const lapsed = await client.query(
      `update feed_subscriptions set status = 'lapsed', lapsed_at = now(), updated_at = now()
       where bundle_subscription_id = $1 and status <> 'lapsed'`,
      [bundle.id]
    );
    await client.query(
      `update bundle_subscriptions
       set status = 'ended', ended_at = now(), ended_by = $2, end_reason = $3, end_mode = $4
       where id = $1`,
      [bundle.id, args.actorUserId, args.reason ?? null, args.mode]
    );
    return { bundle, revoked, lapsedRows: lapsed.rowCount ?? 0, allowlistRevoked: allow.rowCount ?? 0 };
  });

  if (args.mode === "cancel") {
    const row = done.revoked;
    if (row) {
      await afterCommit("revoked notify", () =>
        notifyLicenseRevoked({
          client: { email: row.email, telegramUsername: row.telegram_username, userId: row.user_id },
          licenseKey: row.license_key,
          tier: row.tier,
          revokedAt: new Date(),
        })
      );
    }
    await afterCommit("paid-group sync", async () => {
      const target = await getAlertTargetForLicense(done.bundle.license_id);
      if (target?.telegramUserId) await removeFromPaidGroupIfNoOtherActiveLicense(target.userId, target.telegramUserId);
    });
  }

  return { lapsedRows: done.lapsedRows, allowlistRevoked: done.allowlistRevoked, licenceRevoked: args.mode === "cancel" };
}

export interface RenewBundleArgs {
  actorUserId: string;
  bundleId: string;
  termDays: number;
  amountUsd: number;
  receivedAt?: Date;
}

export interface RenewBundleResult {
  expiresAt: Date;
  paymentId: string;
  /** null when the licence still has no server. */
  feed: BundleFeedGrantResult | null;
}

/** ONE transaction, in this order (Fable C6): refuse a revoked licence (read on the tx client) -> extend the
 * licence -> grant the feed, which re-grants any missing or lapsed member and rewrites ends_at on the stamped
 * rows -> the ONE 'bundle' payment. The new expiry runs from the later of now and the current expiry. */
export async function renewBundle(args: RenewBundleArgs): Promise<RenewBundleResult> {
  assertTermDays(args.termDays);
  assertAmount(args.amountUsd);
  const termMs = args.termDays * 24 * 60 * 60 * 1000;

  const done = await inTransaction(async (client) => {
    const bundle = await lockBundle(client, args.bundleId);
    if (bundle.is_trial) throw new BundleTrialRenewError();
    const before = await lockLicence(client, bundle.license_id);
    if (before.status === "revoked") throw new LicenceRevokedError(before.license_number);

    const from = Math.max(Date.now(), new Date(before.expires_at).getTime());
    const expiresAt = new Date(from + termMs);
    await extendLicenseOn(client, bundle.license_id, expiresAt);

    const licence = await lockLicence(client, bundle.license_id);
    const hasServer = await client.query(`select 1 from server_registrations where license_id = $1`, [bundle.license_id]);
    const feed = hasServer.rowCount ? await grantBundleFeedOn(client, bundle, licence) : null;

    const user = await client.query<{ email: string | null }>(`select email from users where id = $1`, [bundle.user_id]);
    const def = bundleByKey(bundle.bundle_key)!;
    const paymentId = await insertPaymentOn(client, {
      receivedAt: args.receivedAt ?? new Date(),
      amountUsd: args.amountUsd,
      currency: "USD",
      direction: "in",
      category: "bundle",
      counterparty: user.rows[0]?.email ?? null,
      userId: bundle.user_id,
      memo: `Bundle: ${def.title} (${bundle.feed_choice}) renewal ${bundle.id.slice(0, 8)}`,
      createdBy: args.actorUserId,
      bundleSubscriptionId: bundle.id,
    });
    return { expiresAt: licence.expires_at, paymentId, feed };
  });

  await afterCommit("referral hook", () => maybeCreateReferralEarning(done.paymentId));
  return done;
}
