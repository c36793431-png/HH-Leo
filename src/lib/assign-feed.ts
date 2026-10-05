import { pool } from "./db";
import { getActiveLicensesForUser, licenseNumberSql, type FeedType } from "./licenses";
import {
  computeFeedAssignmentRows,
  getFeedTierSubscriptionsForSubscriber,
  listFeedTiersForAdminPicker,
  type FeedTierGrantResult,
  type SubscriberFeedTierSubscription,
} from "./feed-subscriptions";
import { assignFeedTierForUser } from "./assign-feed-tier";
import { findAgentActor, resolveUser, AGENT_ACTOR_EMAIL, RefusedError, UsageError } from "./assign-trial";

/** The library behind scripts/assign-feed.mts (marcus m60735 scope, m60748 go): an agent grants
 * a client one Horizon-catalogue feed tier through the same assignFeedTierSubscription as the
 * admin "Feed provider assignment" control.
 *
 * planFeed is the dry run and must stay plain SELECTs. In particular it never calls
 * assignPseudonymSeq or pseudonymForSubscriber: both ALLOCATE a provider pseudonym (they write),
 * and the panel-render path that calls the second is how a view once allocated HH numbers. */

/** The grant path is DB only (no DM, no email, no ping), so the database is all it needs. */
export const REQUIRED_ENV = ["NEON_DATABASE_URL"] as const;

export interface AssignFeedArgs {
  user: string;
  tierKey: string;
  execute: boolean;
  allowInternal: boolean;
}

export const USAGE = "npx tsx scripts/assign-feed.mts --user <uuid|email> --tier <tier_key> [--allow-internal] [--execute]";

export function parseAssignFeedArgs(argv: string[]): AssignFeedArgs {
  let user: string | undefined;
  let tierKey: string | undefined;
  let execute = false;
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
    else if (flag === "--tier") tierKey = value().trim();
    else if (flag === "--execute" && inline === undefined) execute = true;
    else if (flag === "--allow-internal" && inline === undefined) allowInternal = true;
    else throw new UsageError(`Unknown argument: ${arg}`);
  }

  if (!user) throw new UsageError("--user is required");
  if (!tierKey) throw new UsageError("--tier is required (one tier_key per run, as in the panel)");
  return { user, tierKey, execute, allowInternal };
}

export interface FeedLicenceRow {
  id: string;
  licenseNumber: number;
  tier: string;
  status: string;
  expiresAt: Date;
  feedTypes: FeedType[];
}

export type FeedGrantOutcome = FeedTierGrantResult["outcome"];

export interface FeedPlan {
  user: { id: string; email: string | null; displayName: string | null; internal: boolean };
  actor: { id: string; email: string } | null;
  tier: { tierKey: string; name: string; regionKey: string; providerUserId: string | null; providerEmail: string | null };
  /** Unexpired, unrevoked licences: the set the panel's picker takes entitlement from. No keys. */
  currentLicences: FeedLicenceRow[];
  /** The licence the grant binds to: getActiveLicensesForUser, the resolver the grant itself calls. */
  boundLicence: { id: string; licenseNumber: number; expiresAt: Date } | null;
  server: { id: string; name: string; declaredIp: string } | null;
  subscriptions: SubscriberFeedTierSubscription[];
  /** What the grant would do on this server: assignFeedTierSubscription's three branches. */
  outcome: FeedGrantOutcome | null;
  existingRow: { id: string; status: string; providerUserId: string } | null;
  /** Whether the (provider, client) pair already has a pseudonym. Read, never allocated here. */
  pseudonymExists: boolean | null;
  allowlistRecorded: boolean | null;
  adminAction: { admin_user_id: string | null; action_type: string; target_user_id: string; details: Record<string, unknown> };
  refusals: string[];
}

export function missingEnv(env: Record<string, string | undefined> = process.env): string[] {
  return REQUIRED_ENV.filter((name) => !env[name]?.trim());
}

/** Reads only, plain SELECTs. Everything execute would do, and every reason it would refuse:
 * the refusals assignFeedTierSubscription makes, plus the panel's own gates (picker and Grant button). */
export async function planFeed(args: AssignFeedArgs, env: Record<string, string | undefined> = process.env): Promise<FeedPlan> {
  const u = await resolveUser(args.user);
  const user = { id: u.id, email: u.email, displayName: u.displayName, internal: u.internal };
  const actor = await findAgentActor();

  const tierResult = await pool.query(
    `select ft.id, ft.tier_key, ft.name, ft.region_key, ft.provider_user_id, p.email as provider_email
     from feed_tiers ft left join users p on p.id = ft.provider_user_id
     where ft.tier_key = $1`,
    [args.tierKey]
  );
  if (!tierResult.rows.length) {
    const known = (await listFeedTiersForAdminPicker()).map((t) => t.tierKey);
    throw new RefusedError(`Unknown tier "${args.tierKey}". Known: ${known.join(", ")}`);
  }
  const t = tierResult.rows[0];
  const feedTierId: string = t.id;
  const tier = { tierKey: t.tier_key, name: t.name, regionKey: t.region_key, providerUserId: t.provider_user_id, providerEmail: t.provider_email };

  // The panel's "current" set (computeLicenseDisplayStatus active or expiring).
  const licenceResult = await pool.query(
    `select id, tier, status, expires_at, feed_types, ${licenseNumberSql("licenses")} as license_number
     from licenses where user_id = $1 and status != 'revoked' and expires_at > now()
     order by expires_at desc, issued_at desc`,
    [user.id]
  );
  const currentLicences: FeedLicenceRow[] = licenceResult.rows.map((r) => ({
    id: r.id,
    licenseNumber: Number(r.license_number),
    tier: r.tier,
    status: r.status,
    expiresAt: r.expires_at,
    feedTypes: r.feed_types ?? [],
  }));

  const active = await getActiveLicensesForUser(user.id);
  const boundLicence = active.length === 1 ? { id: active[0].id, licenseNumber: active[0].licenseNumber, expiresAt: active[0].expiresAt } : null;

  const subscriptions = await getFeedTierSubscriptionsForSubscriber(user.id);

  const refusals: string[] = [];
  const missing = missingEnv(env);
  if (missing.length) refusals.push(`Missing env: ${missing.join(", ")}`);
  if (!actor) refusals.push(`Actor ${AGENT_ACTOR_EMAIL} not found: apply scripts/seed-agent-actor.sql first`);
  // Same rule as assign-trial (fable N4, marcus m60782): the grant allocates the pair a provider
  // pseudonym, so an internal or test account would use up a number in that provider's sequence.
  // A QA run has to say so.
  if (user.internal && !args.allowInternal) {
    refusals.push(`${user.email} is an internal or test account (licenses.ts notAClientSql). Pass --allow-internal to grant to it`);
  }
  if (!tier.providerUserId) refusals.push(`${tier.name} has no provider account assigned yet`);
  if (active.length === 0) refusals.push("No active, unexpired licence: a feed grant binds to one. Issue or renew a licence first");
  if (active.length > 1) {
    refusals.push(`${active.length} active licences (${active.map((l) => `HH${l.licenseNumber}`).join(", ")}): the grant would not know which server. Approve the client's own request instead`);
  }

  // The panel only offers a tier whose region the client's current licences carry (or one it
  // already holds a row in, or an ungated region such as cme). Same function, same inputs.
  const entitled = [...new Set(currentLicences.flatMap((l) => l.feedTypes))];
  const rows = computeFeedAssignmentRows(await listFeedTiersForAdminPicker(), subscriptions, entitled);
  const offeredIn = rows.find((r) => r.kind === "assignable" && r.tiers.some((x) => x.tierKey === tier.tierKey));
  if (!offeredIn) {
    refusals.push(`The admin panel would not offer ${tier.name}: the client's licence feeds (${entitled.join(",") || "none"}) do not cover region ${tier.regionKey}`);
  } else {
    // Offered, but the Grant button may still be disabled (fable m60813 S1/S2): the button's own
    // predicate, from the same rows. The no-provider reason is already refused above.
    for (const reason of offeredIn.grantBlockers[tier.tierKey] ?? []) {
      if (!refusals.includes(reason)) refusals.push(reason);
    }
  }

  let server: FeedPlan["server"] = null;
  let existingRow: FeedPlan["existingRow"] = null;
  let outcome: FeedPlan["outcome"] = null;
  let pseudonymExists: boolean | null = null;
  let allowlistRecorded: boolean | null = null;

  if (boundLicence) {
    const sr = await pool.query(`select id, server_name, declared_ip from server_registrations where license_id = $1`, [boundLicence.id]);
    if (!sr.rows.length) {
      refusals.push(`HH${boundLicence.licenseNumber} has no registered server: the client registers one under Account > Servers first`);
    } else {
      server = { id: sr.rows[0].id, name: sr.rows[0].server_name, declaredIp: sr.rows[0].declared_ip };

      // assignFeedTierSubscription's own lookup, without the FOR UPDATE.
      const ex = await pool.query(
        `select id, status, provider_user_id from feed_subscriptions
         where server_registration_id = $1 and feed_tier_id = $2
         order by (status = 'lapsed'), created_at desc
         limit 1`,
        [server.id, feedTierId]
      );
      if (ex.rows.length) existingRow = { id: ex.rows[0].id, status: ex.rows[0].status, providerUserId: ex.rows[0].provider_user_id };
      if (tier.providerUserId) {
        outcome = !existingRow ? "created" : existingRow.providerUserId === tier.providerUserId ? "reactivated" : "repointed";
      }

      // 0081's live (licence, tier) index still stands: a live row for this licence and tier on
      // another (or no) server makes the grant fail with DuplicateTierGrantError or 23505.
      const window = await pool.query(
        `select id from feed_subscriptions
         where license_id = $1 and feed_tier_id = $2
           and status in ('trial', 'active') and server_registration_id is distinct from $3::uuid`,
        [boundLicence.id, feedTierId, server.id]
      );
      if (window.rows.length) refusals.push(`HH${boundLicence.licenseNumber} already holds a live ${tier.name} row on another server (${window.rows[0].id})`);

      if (tier.providerUserId) {
        const ps = await pool.query(
          `select 1 from provider_client_pseudonyms where provider_user_id = $1 and subscriber_user_id = $2`,
          [tier.providerUserId, user.id]
        );
        pseudonymExists = ps.rows.length > 0;
      }
      const al = await pool.query(
        `select 1 from feed_allowlist_records
         where server_registration_id = $1 and feed_tier_id = $2 and ip = $3 and revoked_at is null`,
        [server.id, feedTierId, server.declaredIp]
      );
      allowlistRecorded = al.rows.length > 0;
    }
  }

  return {
    user,
    actor,
    tier,
    currentLicences,
    boundLicence,
    server,
    subscriptions,
    outcome,
    existingRow,
    pseudonymExists,
    allowlistRecorded,
    adminAction: {
      admin_user_id: actor?.id ?? null,
      action_type: "admin_users_assign_feed_subscription",
      target_user_id: user.id,
      details: { tierKey: tier.tierKey, via: "cli" },
    },
    refusals,
  };
}

/** Writes. Refuses unless the plan has no refusals; assignFeedTierSubscription re-checks every
 * one of its own inside its transaction. */
export async function executeFeed(plan: FeedPlan): Promise<FeedTierGrantResult> {
  if (plan.refusals.length || !plan.actor) {
    throw new RefusedError(`Refusing: ${plan.refusals.join("; ") || "no actor"}`);
  }
  return assignFeedTierForUser({ actorUserId: plan.actor.id, userId: plan.user.id, tierKey: plan.tier.tierKey, via: "cli" });
}

/** Printed on every run: a grant tells nobody. */
export function allowlistReminder(ip: string, tierName: string, providerEmail: string | null): string {
  return (
    `MANUAL STEP: nobody is notified by this. The provider (${providerEmail ?? "no provider"}) still has to allowlist ` +
    `the client's IP ${ip} for ${tierName} by hand. feed_allowlist_records only records it as told.`
  );
}
