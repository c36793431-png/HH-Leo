/* Grant a client one feed tier from the command line (marcus m60735 scope, m60748 go).
 *
 *   npx tsx scripts/assign-feed.mts --user <uuid|email> --tier <tier_key> [--allow-internal] [--execute]
 *
 * Run from the repo root with NEON_DATABASE_URL in the shell (or npx tsx --env-file=<file>).
 * DRY RUN unless --execute: plain SELECTs only, never a pseudonym allocation. It prints the user,
 * their current licences (no keys), the bound licence, its server and declared IP, their feed
 * subscriptions, the tier and its provider, and whether the grant would create, reactivate or
 * re-point a row.
 * --execute goes through assignFeedTierForUser, the same function as the "Feed provider
 * assignment" control on /admin/users/[id], as the marcus-agent@horizonhft.internal actor.
 * Refuses on: missing env, missing actor row, no user or several, an internal or test account
 * (the actor itself included) without --allow-internal, an unknown tier, a tier with no provider,
 * zero or several active licences, no registered server, a tier the panel would not offer, a live
 * row for this licence and tier on another server.
 * Nobody is notified, same as the panel: every run prints the IP the provider must allowlist. */
import {
  allowlistReminder,
  executeFeed,
  missingEnv,
  parseAssignFeedArgs,
  planFeed,
  USAGE,
  type FeedPlan,
} from "../src/lib/assign-feed.js";
import { RefusedError, UsageError } from "../src/lib/assign-trial.js";
import { pool } from "../src/lib/db.js";

const OUTCOME_TEXT = {
  created: "CREATE a new active row on this server",
  reactivated: "REACTIVATE the existing row (same provider): status active, ends_at = the licence's expiry",
  repointed: "RE-POINT the existing row to the tier's current provider, and reactivate it",
} as const;

function printPlan(plan: FeedPlan) {
  const u = plan.user;
  const t = plan.tier;
  console.log(`User:      ${u.id}  ${u.email ?? "(no email)"}${u.displayName ? `  "${u.displayName}"` : ""}`);
  console.log(`Actor:     ${plan.actor ? `${plan.actor.id}  ${plan.actor.email}` : "MISSING"}`);
  console.log(`Tier:      ${t.tierKey}  "${t.name}"  region ${t.regionKey}  provider ${t.providerUserId ? `${t.providerUserId}  ${t.providerEmail ?? "(no email)"}` : "NONE"}`);
  console.log(`Current licences: ${plan.currentLicences.length === 0 ? "none" : plan.currentLicences.length}`);
  for (const l of plan.currentLicences) {
    console.log(`  HH${l.licenseNumber}  ${l.tier.padEnd(5)}  ${l.status.padEnd(7)}  expires ${l.expiresAt.toISOString()}  feeds ${l.feedTypes.join(",") || "-"}`);
  }
  console.log(`Binds to:  ${plan.boundLicence ? `HH${plan.boundLicence.licenseNumber}  ends_at ${plan.boundLicence.expiresAt.toISOString()}` : "-"}`);
  console.log(`Server:    ${plan.server ? `${plan.server.id}  "${plan.server.name}"  declared IP ${plan.server.declaredIp}` : "-"}`);
  console.log(`Feed subscriptions: ${plan.subscriptions.length === 0 ? "none" : plan.subscriptions.length}`);
  for (const s of plan.subscriptions) {
    console.log(`  ${s.tierKey.padEnd(14)}  ${s.regionKey.padEnd(6)}  ${s.status.padEnd(7)}${s.lapsedAt ? `  lapsed ${s.lapsedAt.toISOString()}` : ""}`);
  }
  if (plan.outcome) {
    const already = plan.existingRow?.status === "active" && plan.outcome === "reactivated" ? " (already active; only ends_at is rewritten)" : "";
    console.log(`Would:     ${OUTCOME_TEXT[plan.outcome]}${plan.existingRow ? ` [row ${plan.existingRow.id}, now ${plan.existingRow.status}]` : ""}${already}`);
  }
  if (plan.pseudonymExists !== null) {
    console.log(`Pseudonym: ${plan.pseudonymExists ? "the pair already has one" : "none yet; execute allocates one inside the grant's transaction"}`);
  }
  if (plan.allowlistRecorded !== null) {
    console.log(`Allowlist record: ${plan.allowlistRecorded ? "already open for this IP" : "execute writes one (told_at = now)"}`);
  }
  console.log(`admin_actions row: ${JSON.stringify(plan.adminAction)}`);
}

async function main() {
  const args = parseAssignFeedArgs(process.argv.slice(2));
  if (missingEnv().length) throw new RefusedError("NEON_DATABASE_URL is not set; nothing can be read");

  const plan = await planFeed(args);
  console.log(args.execute ? "EXECUTE" : "DRY RUN (plain SELECTs only; pass --execute to grant)");
  printPlan(plan);

  if (plan.refusals.length) {
    console.log(`\n${args.execute ? "REFUSED" : "Would REFUSE on --execute"}:`);
    for (const r of plan.refusals) console.log(`  - ${r}`);
    if (args.execute) process.exitCode = 1;
    return;
  }
  if (!args.execute) {
    console.log(`\nWould grant. Re-run with --execute.`);
    console.log(allowlistReminder(plan.server!.declaredIp, plan.tier.name, plan.tier.providerEmail));
    return;
  }

  let result: Awaited<ReturnType<typeof executeFeed>>;
  try {
    result = await executeFeed(plan);
  } catch (err) {
    console.log(
      `\nERROR during execute: ${(err as Error).message}\n` +
        `The grant runs in one transaction, so a refusal from it wrote nothing. The admin_actions row is written after ` +
        `the commit: check /admin/users/${plan.user.id} before re-running.`
    );
    process.exitCode = 1;
    return;
  }
  console.log(`\nGRANTED  ${plan.tier.tierKey}  ${result.outcome}  subscription ${result.subscriptionId}  HH${result.licenseNumber}  server "${result.serverName}"`);
  console.log(allowlistReminder(result.declaredIp, plan.tier.name, plan.tier.providerEmail));
}

try {
  await main();
} catch (err) {
  if (err instanceof UsageError) console.log(`${err.message}\nUsage: ${USAGE}`);
  else if (err instanceof RefusedError) console.log(`REFUSED: ${err.message}`);
  else console.log(`ERROR: ${(err as Error).stack ?? err}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
