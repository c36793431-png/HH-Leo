import { pool } from "./db";
import { licenseNumberSql, getActiveLicensesForUser, getGroupTarget, type FeedType } from "./licenses";
import { getPortalConfig } from "./portal-config";
import { logAdminAction } from "./admin";
import { addApprovedNotice } from "./client-reach";
import type { NotifyOutcome } from "./notify";
import { setBasketRequestHandled } from "./basket-requests";
import { isReceivableUsdAmount } from "./payments";
import { bundleByKey, bundleFeedTierKeys, bundleFeedType, isBundleFeedChoice, type BundleFeedChoice, type BundleKey } from "./bundle-catalogue";
import {
  activateBundle,
  grantBundleFeed,
  BUNDLE_FEED_SHARE_CONFIG_KEY,
  type ActivateBundleArgs,
  type ActivateBundleResult,
  type BundleFeedGrantResult,
} from "./bundles";
import {
  grantWhat,
  keyDeliveryChannel,
  licenseNotification,
  recordKeyDelivery,
  sendKeyAndRecord,
  NO_USERS_ROW,
  type KeyDelivery,
} from "./issue-new-license";
import { AGENT_ACTOR_EMAIL, findAgentActor, missingEnv, resolveUser, RefusedError, UsageError } from "./assign-trial";

/** The library behind scripts/activate-bundle.mts (plan m69164 section 4, BUILD GO marcus m69165): activates a
 * Horizon Complete bundle through the shipped activateBundle writer, then does what that writer leaves out --
 * the client's key send, the admin_actions row and the basket row -- and, as a second run once the client's
 * server is registered, grants the bundle's feed through grantBundleFeed. No SQL writes of its own.
 * Same shape as assign-trial: dry run by default, --execute, env preflight, the seeded marcus-agent actor. */

export { RefusedError, UsageError };

/** admin_actions.action_type for an activation run (plan m69164 step 3). */
export const BUNDLE_ACTIVATE_ACTION = "bundle_activate";

export const USAGE =
  "npx tsx scripts/activate-bundle.mts --user <uuid|email> --bundle <key> --feed <choice> --days <N> (--trial | --amount-usd <X> [--received-at <ISO date>]) --basket <uuid> [--allow-repeat-trial] [--allow-internal] [--execute]\n" +
  "       npx tsx scripts/activate-bundle.mts --grant-feed <bundle id> [--execute]";

export interface ActivateArgs {
  mode: "activate";
  user: string;
  bundleKey: BundleKey;
  feedChoice: BundleFeedChoice;
  days: number;
  isTrial: boolean;
  amountUsd: number | null;
  receivedAt: Date | null;
  basketId: string;
  allowRepeatTrial: boolean;
  allowInternal: boolean;
  execute: boolean;
}

export interface GrantArgs {
  mode: "grant-feed";
  bundleId: string;
  execute: boolean;
}

export type ActivateBundleCliArgs = ActivateArgs | GrantArgs;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseActivateBundleArgs(argv: string[]): ActivateBundleCliArgs {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  const VALUE_FLAGS = ["--user", "--bundle", "--feed", "--days", "--amount-usd", "--received-at", "--basket", "--grant-feed"];
  const BOOL_FLAGS = ["--trial", "--execute", "--allow-repeat-trial", "--allow-internal"];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    if (VALUE_FLAGS.includes(flag)) {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
      if (flag in values) throw new UsageError(`${flag} given twice`);
      values[flag] = v.trim();
    } else if (BOOL_FLAGS.includes(flag) && inline === undefined) {
      flags.add(flag);
    } else {
      throw new UsageError(`Unknown argument: ${arg}`);
    }
  }
  const execute = flags.has("--execute");

  if ("--grant-feed" in values) {
    const others = [...Object.keys(values).filter((f) => f !== "--grant-feed"), ...[...flags].filter((f) => f !== "--execute")];
    if (others.length) throw new UsageError(`--grant-feed takes only --execute, not ${others.join(", ")}`);
    if (!UUID_RE.test(values["--grant-feed"])) throw new UsageError(`--grant-feed needs a bundle id (uuid), got "${values["--grant-feed"]}"`);
    return { mode: "grant-feed", bundleId: values["--grant-feed"], execute };
  }

  for (const f of ["--user", "--bundle", "--feed", "--days", "--basket"]) {
    if (!(f in values)) throw new UsageError(`${f} is required${f === "--days" ? " (no default)" : ""}`);
  }
  const bundle = bundleByKey(values["--bundle"]);
  if (!bundle) throw new UsageError(`Unknown bundle: ${values["--bundle"]}`);
  const feed = values["--feed"];
  if (!isBundleFeedChoice(feed) || !bundle.feedChoices.includes(feed)) {
    throw new UsageError(`Unknown feed for ${bundle.title}: ${feed}. Known: ${bundle.feedChoices.join(", ")}`);
  }
  if (!/^[1-9]\d*$/.test(values["--days"])) throw new UsageError(`--days must be a whole number of days, got "${values["--days"]}"`);
  if (!UUID_RE.test(values["--basket"])) throw new UsageError(`--basket needs the basket request id (uuid), got "${values["--basket"]}"`);

  const isTrial = flags.has("--trial");
  let amountUsd: number | null = null;
  let receivedAt: Date | null = null;
  if (isTrial) {
    if ("--amount-usd" in values || "--received-at" in values) throw new UsageError("--trial records no payment: drop --amount-usd / --received-at");
  } else {
    if (!("--amount-usd" in values)) throw new UsageError("Pass --trial, or --amount-usd with the amount actually received (no default)");
    if (!/^\d+(\.\d{1,2})?$/.test(values["--amount-usd"]) || !isReceivableUsdAmount(Number(values["--amount-usd"]))) {
      throw new UsageError(`--amount-usd must be a dollar amount above 0, like 100 or 99.50, got "${values["--amount-usd"]}"`);
    }
    amountUsd = Number(values["--amount-usd"]);
    if ("--received-at" in values) {
      receivedAt = new Date(values["--received-at"]);
      if (Number.isNaN(receivedAt.getTime())) throw new UsageError(`--received-at must be a date, like 2026-10-14, got "${values["--received-at"]}"`);
      if (receivedAt.getTime() > Date.now()) throw new UsageError("--received-at is in the future");
    }
  }

  return {
    mode: "activate",
    user: values["--user"],
    bundleKey: bundle.key,
    feedChoice: feed,
    days: Number(values["--days"]),
    isTrial,
    amountUsd,
    receivedAt,
    basketId: values["--basket"],
    allowRepeatTrial: flags.has("--allow-repeat-trial"),
    allowInternal: flags.has("--allow-internal"),
    execute,
  };
}

export interface TierProvider {
  tierKey: string;
  name: string | null;
  providerUserId: string | null;
}

/** The member tiers of a feed choice and who provides each; a tier missing from feed_tiers comes back with name null. */
async function tierProviders(choice: BundleFeedChoice): Promise<TierProvider[]> {
  const keys = bundleFeedTierKeys(choice);
  const r = await pool.query(`select tier_key, name, provider_user_id from feed_tiers where tier_key = any($1)`, [keys]);
  return keys.map((k) => {
    const row = r.rows.find((x) => x.tier_key === k);
    return { tierKey: k, name: row?.name ?? null, providerUserId: row?.provider_user_id ?? null };
  });
}

/** The configured feed share for a choice, in cents, or null when unset or not a positive whole number --
 * the same test bundles.ts feedShareCents refuses on. */
async function configuredShareCents(choice: BundleFeedChoice): Promise<number | null> {
  const r = await pool.query(`select value from portal_config where key = $1`, [BUNDLE_FEED_SHARE_CONFIG_KEY]);
  const value = r.rows[0]?.value;
  const cents = value && typeof value === "object" ? (value as Record<string, unknown>)[choice] : undefined;
  return typeof cents === "number" && Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export interface ActivationPlan {
  args: ActivateArgs;
  user: { id: string; email: string | null; telegramUserId: string | null; displayName: string | null; internal: boolean };
  actor: { id: string; email: string } | null;
  licences: { id: string; licenseNumber: number; tier: string; status: string; expiresAt: Date; live: boolean }[];
  activeBundle: { id: string; bundleKey: string; feedChoice: string } | null;
  basket: { id: string; userId: string; status: string; hasTrial: boolean; lines: { kind: string; key: string; name: string; feed?: string }[] } | null;
  tiers: TierProvider[];
  /** Read for a paid bundle only (a trial's feed rows carry 0). Needed before --grant-feed, not at activate. */
  shareCents: number | null;
  delivery: KeyDelivery;
  subject: string;
  maskedMessage: string;
  /** What execute passes to activateBundle; the actor id is the seeded agent's. */
  activateArgs: Omit<ActivateBundleArgs, "actorUserId"> & { actorUserId: string | null };
  adminAction: { admin_user_id: string | null; action_type: string; target_user_id: string; details: Record<string, unknown> };
  refusals: string[];
}

/** Reads only. Everything an activation would do, and every reason it would refuse. */
export async function planActivation(args: ActivateArgs, env: Record<string, string | undefined> = process.env): Promise<ActivationPlan> {
  const bundle = bundleByKey(args.bundleKey)!;
  const user = await resolveUser(args.user);
  const actor = await findAgentActor();

  const licenceRows = await pool.query(
    `select id, tier, status, expires_at, (status = 'active' and expires_at > now()) as live, ${licenseNumberSql("licenses")} as license_number
     from licenses where user_id = $1 order by issued_at, id`,
    [user.id]
  );
  const licences = licenceRows.rows.map((r) => ({
    id: r.id as string,
    licenseNumber: Number(r.license_number),
    tier: r.tier as string,
    status: r.status as string,
    expiresAt: r.expires_at as Date,
    live: Boolean(r.live),
  }));

  const bundleRow = await pool.query(`select id, bundle_key, feed_choice from bundle_subscriptions where user_id = $1 and status = 'active'`, [user.id]);
  const activeBundle = bundleRow.rows[0]
    ? { id: bundleRow.rows[0].id as string, bundleKey: bundleRow.rows[0].bundle_key as string, feedChoice: bundleRow.rows[0].feed_choice as string }
    : null;

  const basketRow = await pool.query(`select id, user_id, status, has_trial, lines from basket_requests where id = $1`, [args.basketId]);
  const basket: ActivationPlan["basket"] = basketRow.rows[0]
    ? {
        id: basketRow.rows[0].id as string,
        userId: basketRow.rows[0].user_id as string,
        status: basketRow.rows[0].status as string,
        hasTrial: Boolean(basketRow.rows[0].has_trial),
        lines: typeof basketRow.rows[0].lines === "string" ? JSON.parse(basketRow.rows[0].lines) : basketRow.rows[0].lines,
      }
    : null;

  const tiers = await tierProviders(args.feedChoice);
  const shareCents = args.isTrial ? null : await configuredShareCents(args.feedChoice);

  const tier = args.isTrial ? "trial" : bundle.licenceTier;
  const feedTypes: FeedType[] = [bundleFeedType(args.feedChoice)];
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + args.days * 24 * 60 * 60 * 1000);
  const delivery = keyDeliveryChannel(user);
  const config = await getPortalConfig();
  const { subject, message: maskedMessage } = licenseNotification({
    tier,
    licenseKey: "HHFT-XXXXXX-XXXXXX-XXXXXX",
    licenseNumber: licences.length + 1,
    showBadge: false,
    communityGroupUrl: config.communityGroupUrl,
    issuedAt,
    expiresAt,
    feedTypes,
  });

  const refusals: string[] = [];
  const missing = missingEnv(env);
  if (missing.length) refusals.push(`Missing env: ${missing.join(", ")}`);
  if (!actor) refusals.push(`Actor ${AGENT_ACTOR_EMAIL} not found: apply scripts/seed-agent-actor.sql first`);
  if (user.internal && !args.allowInternal) {
    refusals.push(`${user.email} is an internal or test account (licenses.ts notAClientSql). Pass --allow-internal to activate for it`);
  }
  if (activeBundle) refusals.push(`User already has an active bundle (${activeBundle.bundleKey}, ${activeBundle.feedChoice}, id ${activeBundle.id})`);
  const live = licences.filter((l) => l.live);
  if (live.length) {
    // activateBundle would adopt it (paid) or refuse (trial). Adoption needs the overlap confirm (fold m66997 N2,
    // ruled m67000), which is the slice-3 admin card's, so this script only issues a NEW licence.
    refusals.push(
      `User already has an active licence (${live.map((l) => `HH${l.licenseNumber} ${l.tier}, expires ${l.expiresAt.toISOString()}`).join("; ")}). ` +
        `This script issues a new licence only; adopting one needs the overlap confirm (slice 3)`
    );
  }
  const pastTrials = licences.filter((l) => l.tier === "trial");
  if (args.isTrial && pastTrials.length && !args.allowRepeatTrial) {
    refusals.push(`User has had ${pastTrials.length} trial licence(s) before (see history). Pass --allow-repeat-trial to issue another`);
  }
  if (!basket) refusals.push(`No basket request ${args.basketId}`);
  else {
    if (basket.userId !== user.id) refusals.push(`Basket request ${basket.id} belongs to another user (${basket.userId})`);
    if (basket.status !== "new") refusals.push(`Basket request ${basket.id} is already '${basket.status}'`);
    const line = basket.lines.find((l) => l.kind === "bundle");
    if (!line) refusals.push(`Basket request ${basket.id} has no bundle line`);
    else if (line.key !== args.bundleKey || line.feed !== args.feedChoice) {
      refusals.push(`Basket request ${basket.id} asked for ${line.key} (${line.feed ?? "no feed"}), not ${args.bundleKey} (${args.feedChoice})`);
    }
  }
  if (delivery === "none") refusals.push("User has no Telegram id and no email: the key could not be delivered");

  return {
    args,
    user,
    actor,
    licences,
    activeBundle,
    basket,
    tiers,
    shareCents,
    delivery,
    subject,
    maskedMessage,
    activateArgs: {
      actorUserId: actor?.id ?? null,
      userId: user.id,
      bundleKey: args.bundleKey,
      feedChoice: args.feedChoice,
      termDays: args.days,
      isTrial: args.isTrial,
      amountUsd: args.amountUsd,
      ...(args.receivedAt ? { receivedAt: args.receivedAt } : {}),
      basketRequestId: args.basketId,
    },
    adminAction: {
      admin_user_id: actor?.id ?? null,
      action_type: BUNDLE_ACTIVATE_ACTION,
      target_user_id: user.id,
      details: { bundleId: "<new>", licenseId: "<new>", isTrial: args.isTrial, amountUsd: args.amountUsd, basketRequestId: args.basketId },
    },
    refusals,
  };
}

export interface ActivationOutcome {
  result: ActivateBundleResult;
  delivery: KeyDelivery;
  /** What the key send answered (its license_key_delivery row holds the same); ok false = the key did NOT reach
   * the client, and the unreachable alert was raised. null when the send threw (sendError). */
  keySend: NotifyOutcome | null;
  /** The key send threw. Steps 3 and 4 still ran. A throw from the send itself (a Telegram throw propagates out of
   * sendKeyAndRecord) has its license_key_delivery row; one before it (a DB read in sendBundleKey) has none. */
  sendError: Error | null;
  /** false: the basket row was no longer 'new' when step 4 ran, so nothing changed. */
  basketMarked: boolean;
}

/** The new licence's key to the client, as issueNewLicenseForUser sends it: the approved banner first, then the
 * DM or email and its license_key_delivery row (the unreachable alert when it reaches nobody). */
async function sendBundleKey(plan: ActivationPlan, actorId: string, result: ActivateBundleResult, issuedAt: Date): Promise<NotifyOutcome> {
  const userId = plan.user.id;
  const target = await getGroupTarget(userId);
  if (!target) {
    await recordKeyDelivery(actorId, userId, result.licenseId, NO_USERS_ROW);
    return NO_USERS_ROW;
  }
  const tier = plan.args.isTrial ? "trial" : bundleByKey(plan.args.bundleKey)!.licenceTier;
  const feedTypes: FeedType[] = [bundleFeedType(plan.args.feedChoice)];
  const config = await getPortalConfig();
  const showBadge = (await getActiveLicensesForUser(userId)).length > 1;
  const expiresAt = new Date(result.expiresAt);
  const { subject, message } = licenseNotification({
    tier,
    licenseKey: result.licenseKey,
    licenseNumber: result.licenseNumber,
    showBadge,
    communityGroupUrl: config.communityGroupUrl,
    issuedAt,
    expiresAt,
    feedTypes,
  });
  const what = grantWhat({ tier, feedTypes, issuedAt, expiresAt });
  await addApprovedNotice(userId, what);
  return sendKeyAndRecord(actorId, result.licenseId, target, subject, message, what);
}

/** Writes, in the m69164 order: (1) activateBundle, one tx; (2) the key send; (3) the bundle_activate
 * admin_actions row; (4) the basket row to handled. Refuses unless the plan has no refusals. */
export async function executeActivation(plan: ActivationPlan): Promise<ActivationOutcome> {
  if (plan.refusals.length || !plan.actor) throw new RefusedError(`Refusing: ${plan.refusals.join("; ") || "no actor"}`);
  const actorId = plan.actor.id;
  const issuedAt = new Date();

  const result = await activateBundle({ ...plan.activateArgs, actorUserId: actorId });

  let keySend: NotifyOutcome | null = null;
  let sendError: Error | null = null;
  try {
    keySend = await sendBundleKey(plan, actorId, result, issuedAt);
  } catch (err) {
    sendError = err instanceof Error ? err : new Error(String(err));
  }

  await logAdminAction(
    actorId,
    BUNDLE_ACTIVATE_ACTION,
    plan.user.id,
    { bundleId: result.bundleId, licenseId: result.licenseId, isTrial: plan.args.isTrial, amountUsd: plan.args.amountUsd, basketRequestId: plan.args.basketId },
    result.licenseId
  );

  const marked = await setBasketRequestHandled(plan.args.basketId, actorId, true);
  return { result, delivery: keyDeliveryChannel(plan.user), keySend, sendError, basketMarked: marked !== null };
}

export interface GrantPlan {
  args: GrantArgs;
  bundle: { id: string; userId: string; email: string | null; bundleKey: string; feedChoice: BundleFeedChoice; status: string; isTrial: boolean; licenseId: string } | null;
  licence: { licenseNumber: number; status: string; expiresAt: Date; live: boolean } | null;
  server: { name: string; declaredIp: string } | null;
  tiers: TierProvider[];
  /** Paid bundles only; null for a trial (its rows carry 0) or when unset. */
  shareCents: number | null;
  refusals: string[];
}

/** Reads only, for step 2: --grant-feed <bundle id> after the client's server is registered. */
export async function planGrant(args: GrantArgs, env: Record<string, string | undefined> = process.env): Promise<GrantPlan> {
  const refusals: string[] = [];
  if (!env.NEON_DATABASE_URL?.trim()) refusals.push("Missing env: NEON_DATABASE_URL");

  const b = await pool.query(
    `select b.id, b.user_id, u.email, b.bundle_key, b.feed_choice, b.status, b.is_trial, b.license_id
     from bundle_subscriptions b join users u on u.id = b.user_id where b.id = $1`,
    [args.bundleId]
  );
  const row = b.rows[0];
  if (!row) {
    refusals.push(`No bundle ${args.bundleId}`);
    return { args, bundle: null, licence: null, server: null, tiers: [], shareCents: null, refusals };
  }
  const bundle = {
    id: row.id as string,
    userId: row.user_id as string,
    email: row.email as string | null,
    bundleKey: row.bundle_key as string,
    feedChoice: row.feed_choice as BundleFeedChoice,
    status: row.status as string,
    isTrial: Boolean(row.is_trial),
    licenseId: row.license_id as string,
  };
  if (bundle.status !== "active") refusals.push(`Bundle ${bundle.id} is '${bundle.status}'`);

  const l = await pool.query(
    `select status, expires_at, (status = 'active' and expires_at > now()) as live, ${licenseNumberSql("licenses")} as license_number
     from licenses where id = $1`,
    [bundle.licenseId]
  );
  const licence = l.rows[0]
    ? { licenseNumber: Number(l.rows[0].license_number), status: l.rows[0].status as string, expiresAt: l.rows[0].expires_at as Date, live: Boolean(l.rows[0].live) }
    : null;
  if (!licence) refusals.push(`The bundle's licence ${bundle.licenseId} is missing`);
  else if (!licence.live) refusals.push(`HH${licence.licenseNumber} is ${licence.status === "active" ? "past expiry" : licence.status}: renew first`);

  const s = await pool.query(`select server_name, declared_ip from server_registrations where license_id = $1`, [bundle.licenseId]);
  const server = s.rows[0] ? { name: s.rows[0].server_name as string, declaredIp: s.rows[0].declared_ip as string } : null;
  if (!server) refusals.push(`No server registered on the bundle's licence yet: the client registers one at /account/servers first`);

  const tiers = await tierProviders(bundle.feedChoice);
  for (const t of tiers) {
    if (!t.name) refusals.push(`Unknown feed tier ${t.tierKey}`);
    else if (!t.providerUserId) refusals.push(`${t.name} has no provider assigned`);
  }

  const shareCents = bundle.isTrial ? null : await configuredShareCents(bundle.feedChoice);
  if (!bundle.isTrial && shareCents === null) {
    refusals.push(`portal_config ${BUNDLE_FEED_SHARE_CONFIG_KEY} has no share for ${bundle.feedChoice}: a paid bundle's feed can't be granted until it is set`);
  }
  return { args, bundle, licence, server, tiers, shareCents, refusals };
}

/** Writes: grantBundleFeed, one tx. Refuses unless the plan has no refusals. */
export async function executeGrant(plan: GrantPlan): Promise<BundleFeedGrantResult> {
  if (plan.refusals.length || !plan.bundle) throw new RefusedError(`Refusing: ${plan.refusals.join("; ") || "no bundle"}`);
  return grantBundleFeed(plan.bundle.id);
}
