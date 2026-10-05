import { pool } from "./db";
import { FEED_TYPES, licenseNumberSql, notAClientSql, type FeedType, type IssuedLicense } from "./licenses";
import { resolveExpiresAt } from "./duration";
import { getPortalConfig } from "./portal-config";
import {
  issueNewLicenseForUser,
  keyDeliveryChannel,
  licenseReadyMessage,
  LICENSE_READY_SUBJECT,
  type KeyDelivery,
} from "./issue-new-license";

/** The library behind scripts/assign-trial.mts (marcus m60729, scope m60728): an agent assigns a
 * client a trial licence through the same issueNewLicenseForUser the admin panel uses. */

/** A users row seeded by scripts/seed-agent-actor.sql. admin_actions rows are stamped with it, so
 * "By" on /admin/users/[id] says who acted. Looked up and REQUIRED: logAdminAction resolves an
 * unknown actor id to coxwell's row (resolveAdminUserId), which is exactly what this must not do. */
export const AGENT_ACTOR_EMAIL = "marcus-agent@horizonhft.internal";

/** Every var the execute path reads. The key goes out AFTER the insert, so a missing one would
 * leave a licence the client was never sent. Checked before any write.
 * TELEMETRY_BOT_TOKEN is the ops "trial issued" ping; that ping goes to a fixed chat, so
 * TELEMETRY_CHAT_ID is not read on this path. */
export const REQUIRED_ENV = [
  "NEON_DATABASE_URL",
  "HORIZON_PORTAL_BOT_TOKEN",
  "AUTH_RESEND_KEY",
  "EMAIL_FROM",
  "TELEMETRY_BOT_TOKEN",
] as const;

export function missingEnv(env: Record<string, string | undefined> = process.env): string[] {
  return REQUIRED_ENV.filter((name) => !env[name]?.trim());
}

export class UsageError extends Error {}
export class RefusedError extends Error {}

export interface AssignTrialArgs {
  user: string;
  days: number;
  feeds: FeedType[];
  execute: boolean;
  allowRepeatTrial: boolean;
  allowInternal: boolean;
}

export const USAGE =
  "npx tsx scripts/assign-trial.mts --user <uuid|email> --days <N> --feeds <london,ny,...> [--allow-repeat-trial] [--allow-internal] [--execute]";

export function parseAssignTrialArgs(argv: string[]): AssignTrialArgs {
  let user: string | undefined;
  let daysRaw: string | undefined;
  let feedsRaw: string | undefined;
  let execute = false;
  let allowRepeatTrial = false;
  let allowInternal = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
      return v;
    };
    if (flag === "--user") user = value().trim();
    else if (flag === "--days") daysRaw = value().trim();
    else if (flag === "--feeds") feedsRaw = value();
    else if (flag === "--execute" && inline === undefined) execute = true;
    else if (flag === "--allow-repeat-trial" && inline === undefined) allowRepeatTrial = true;
    else if (flag === "--allow-internal" && inline === undefined) allowInternal = true;
    else throw new UsageError(`Unknown argument: ${arg}`);
  }

  if (!user) throw new UsageError("--user is required");
  if (daysRaw === undefined) throw new UsageError("--days is required (no default)");
  if (!/^[1-9]\d*$/.test(daysRaw)) throw new UsageError(`--days must be a whole number of days, got "${daysRaw}"`);
  if (feedsRaw === undefined) throw new UsageError("--feeds is required");

  const names = feedsRaw.split(",").map((f) => f.trim().toLowerCase()).filter(Boolean);
  const unknown = names.filter((f) => !(FEED_TYPES as string[]).includes(f));
  if (unknown.length) throw new UsageError(`Unknown feed(s): ${unknown.join(", ")}. Known: ${FEED_TYPES.join(", ")}`);
  if (names.length === 0) throw new UsageError("--feeds needs at least one feed");

  return { user, days: Number(daysRaw), feeds: [...new Set(names)] as FeedType[], execute, allowRepeatTrial, allowInternal };
}

export interface LicenceHistoryRow {
  id: string;
  licenseNumber: number;
  tier: string;
  status: string;
  issuedAt: Date;
  expiresAt: Date;
  feedTypes: string[];
  live: boolean;
}

export interface TrialPlan {
  user: { id: string; email: string | null; telegramUserId: string | null; displayName: string | null; internal: boolean };
  actor: { id: string; email: string } | null;
  licences: LicenceHistoryRow[];
  expiresAt: Date;
  feedTypes: FeedType[];
  delivery: KeyDelivery;
  subject: string;
  /** The DM/email text with the key masked. The real key is generated at insert time. */
  maskedMessage: string;
  /** The admin_actions row execute would write, licence id still unknown. */
  adminAction: { admin_user_id: string | null; action_type: string; target_user_id: string; details: Record<string, unknown> };
  /** Why execute would refuse. Empty means it would go ahead. */
  refusals: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveUser(ref: string): Promise<TrialPlan["user"]> {
  const result = UUID_RE.test(ref)
    ? await pool.query(`select id, email, telegram_user_id, display_name, ${notAClientSql("users")} as internal from users where id = $1`, [ref])
    : await pool.query(
        `select id, email, telegram_user_id, display_name, ${notAClientSql("users")} as internal from users where lower(email) = lower($1) order by created_at`,
        [ref]
      );
  if (result.rows.length === 0) throw new RefusedError(`No user matches ${ref}`);
  if (result.rows.length > 1) {
    throw new RefusedError(`${result.rows.length} users match ${ref}: ${result.rows.map((r) => r.id).join(", ")}. Pass the uuid.`);
  }
  const r = result.rows[0];
  return {
    id: r.id,
    email: r.email,
    telegramUserId: r.telegram_user_id !== null ? String(r.telegram_user_id) : null,
    displayName: r.display_name,
    internal: Boolean(r.internal),
  };
}

/** Reads only. Everything execute would do, and every reason it would refuse. */
export async function planTrial(args: AssignTrialArgs, env: Record<string, string | undefined> = process.env): Promise<TrialPlan> {
  const user = await resolveUser(args.user);

  const actorResult = await pool.query(`select id, email from users where email = $1`, [AGENT_ACTOR_EMAIL]);
  const actor = actorResult.rows[0] ? { id: actorResult.rows[0].id as string, email: actorResult.rows[0].email as string } : null;

  const licenceResult = await pool.query(
    `select id, tier, status, issued_at, expires_at, feed_types,
            (status = 'active' and expires_at > now()) as live,
            ${licenseNumberSql("licenses")} as license_number
     from licenses where user_id = $1
     order by issued_at, id`,
    [user.id]
  );
  const licences: LicenceHistoryRow[] = licenceResult.rows.map((r) => ({
    id: r.id,
    licenseNumber: Number(r.license_number),
    tier: r.tier,
    status: r.status,
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
    feedTypes: r.feed_types ?? [],
    live: Boolean(r.live),
  }));

  const expiresAt = resolveExpiresAt({ mode: "duration", amount: args.days, unit: "days" });
  const delivery = keyDeliveryChannel(user);
  const config = await getPortalConfig();
  const maskedMessage = licenseReadyMessage({
    licenseKey: "HHFT-XXXXXX-XXXXXX-XXXXXX",
    licenseNumber: licences.length + 1,
    showBadge: false,
    communityGroupUrl: config.communityGroupUrl,
  });

  const refusals: string[] = [];
  const missing = missingEnv(env);
  if (missing.length) refusals.push(`Missing env: ${missing.join(", ")}`);
  if (!actor) refusals.push(`Actor ${AGENT_ACTOR_EMAIL} not found: apply scripts/seed-agent-actor.sql first`);
  // The actor itself, *.internal and test accounts (fable N4, marcus m60768): their email is a dead
  // address, so the key would go nowhere. A QA run on one has to say so.
  if (user.internal && !args.allowInternal) {
    refusals.push(`${user.email} is an internal or test account (licenses.ts notAClientSql). Pass --allow-internal to issue to it`);
  }
  const live = licences.filter((l) => l.live);
  if (live.length) {
    refusals.push(`User already has an active licence (${live.map((l) => `HH${l.licenseNumber} ${l.tier}, expires ${l.expiresAt.toISOString()}`).join("; ")})`);
  }
  const pastTrials = licences.filter((l) => l.tier === "trial");
  if (pastTrials.length && !args.allowRepeatTrial) {
    refusals.push(`User has had ${pastTrials.length} trial licence(s) before (see history). Pass --allow-repeat-trial to issue another`);
  }
  if (delivery === "none") refusals.push("User has no Telegram id and no email: the key could not be delivered");

  return {
    user,
    actor,
    licences,
    expiresAt,
    feedTypes: args.feeds,
    delivery,
    subject: LICENSE_READY_SUBJECT,
    maskedMessage,
    adminAction: {
      admin_user_id: actor?.id ?? null,
      action_type: "admin_users_issue_license",
      target_user_id: user.id,
      details: { licenseId: "<new>", expiresAt: expiresAt.toISOString(), feedTypes: args.feeds, tier: "trial", via: "cli" },
    },
    refusals,
  };
}

/** Writes. Refuses unless the plan has no refusals. */
export async function executeTrial(plan: TrialPlan): Promise<{ license: IssuedLicense; delivery: KeyDelivery }> {
  if (plan.refusals.length || !plan.actor) {
    throw new RefusedError(`Refusing: ${plan.refusals.join("; ") || "no actor"}`);
  }
  return issueNewLicenseForUser({
    actorUserId: plan.actor.id,
    userId: plan.user.id,
    expiresAt: plan.expiresAt,
    feedTypes: plan.feedTypes,
    tier: "trial",
    via: "cli",
  });
}
