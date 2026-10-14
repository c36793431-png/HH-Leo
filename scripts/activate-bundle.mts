/* Activate a Horizon Complete bundle from the command line (plan m69164 section 4, BUILD GO marcus m69165).
 *
 *   npx tsx scripts/activate-bundle.mts --user <uuid|email> --bundle horizon-complete --feed <ld-base|ny-base> --days <N>
 *       (--trial | --amount-usd <X> [--received-at <ISO date>]) --basket <uuid> [--allow-repeat-trial] [--allow-internal] [--execute]
 *   npx tsx scripts/activate-bundle.mts --grant-feed <bundle id> [--execute]
 *
 * Run from the repo root, with the env in the shell (src/lib/assign-trial.ts REQUIRED_ENV).
 * DRY RUN unless --execute: reads only, and prints the user, their licences, any active bundle, the basket row and
 * whether its line matches, the feed's tiers and providers, the feed share (paid), the delivery channel, the
 * activateBundle args, the admin_actions row and the key text with the key masked.
 * --execute, as the marcus-agent@horizonhft.internal actor:
 *   (1) activateBundle: the licence, the bundle row and (paid) the ONE 'bundle' payment, one transaction;
 *   (2) the key to the client by the normal path (approved banner, DM or email, license_key_delivery row);
 *   (3) admin_actions 'bundle_activate';  (4) the basket row to handled.
 * The full key is never printed. A paid run records the amount typed as RECEIVED: run it only once the money is in.
 * Step 2, after the client registers a server: --grant-feed <bundle id> grants the feed (grantBundleFeed). A paid
 * bundle needs portal_config bundle_feed_share_cents first; a trial does not.
 *
 * No process.exit: the pool is ended in finally, after any licence background task settles (capped). */
import {
  executeActivation,
  executeGrant,
  parseActivateBundleArgs,
  planActivation,
  planGrant,
  RefusedError,
  UsageError,
  USAGE,
  type ActivationPlan,
  type GrantPlan,
} from "../src/lib/activate-bundle-cli.js";
import { missingEnv } from "../src/lib/assign-trial.js";
import { maskLicenseKey, settleLicenseBackgroundTasks } from "../src/lib/licenses.js";
import { pool } from "../src/lib/db.js";

const DRAIN_CAP_MS = 15_000;

function printTiers(plan: { tiers: ActivationPlan["tiers"] }) {
  for (const t of plan.tiers) console.log(`  ${t.tierKey.padEnd(12)}  ${t.name ?? "(not in feed_tiers)"}  provider ${t.providerUserId ?? "NONE"}`);
}

function printActivation(plan: ActivationPlan) {
  const u = plan.user;
  console.log(`User:      ${u.id}  ${u.email ?? "(no email)"}  telegram ${u.telegramUserId ?? "none"}${u.displayName ? `  "${u.displayName}"` : ""}`);
  console.log(`Actor:     ${plan.actor ? `${plan.actor.id}  ${plan.actor.email}` : "MISSING"}`);
  console.log(`Licences:  ${plan.licences.length === 0 ? "none" : plan.licences.length}`);
  for (const l of plan.licences) {
    console.log(`  HH${l.licenseNumber}  ${l.tier.padEnd(5)}  ${l.status.padEnd(7)}  ${l.live ? "LIVE " : "     "}  expires ${l.expiresAt.toISOString()}`);
  }
  console.log(`Bundle:    ${plan.activeBundle ? `ACTIVE ${plan.activeBundle.bundleKey} (${plan.activeBundle.feedChoice}) ${plan.activeBundle.id}` : "none active"}`);
  if (plan.basket) {
    const line = plan.basket.lines.find((l) => l.kind === "bundle");
    console.log(`Basket:    ${plan.basket.id}  status ${plan.basket.status}  trial box ${plan.basket.hasTrial ? "yes" : "no"}  bundle line ${line ? `${line.key} (${line.feed ?? "no feed"})` : "NONE"}`);
  } else {
    console.log(`Basket:    NOT FOUND`);
  }
  console.log(`Feed ${plan.args.feedChoice} tiers (granted by --grant-feed once a server is registered):`);
  printTiers(plan);
  console.log(
    `Feed share: ${plan.args.isTrial ? "not read (trial feed rows carry 0)" : plan.shareCents !== null ? `${plan.shareCents} cents` : "NOT SET (activate does not need it; --grant-feed refuses until it is set)"}`
  );
  console.log(`Delivery:  ${plan.delivery}`);
  console.log(`activateBundle(${JSON.stringify(plan.activateArgs)})`);
  console.log(`admin_actions row: ${JSON.stringify(plan.adminAction)}`);
  console.log(`Message (${plan.subject}), key masked:\n  ${plan.maskedMessage.replace(/\n/g, "\n  ")}`);
}

function printGrant(plan: GrantPlan) {
  const b = plan.bundle;
  if (!b) return;
  console.log(`Bundle:    ${b.id}  ${b.bundleKey} (${b.feedChoice})  ${b.status}  ${b.isTrial ? "TRIAL" : "paid"}  user ${b.userId} ${b.email ?? ""}`);
  console.log(`Licence:   ${plan.licence ? `HH${plan.licence.licenseNumber}  ${plan.licence.status}  ${plan.licence.live ? "LIVE" : "not live"}  expires ${plan.licence.expiresAt.toISOString()}` : "MISSING"}`);
  console.log(`Server:    ${plan.server ? `${plan.server.name}  ${plan.server.declaredIp}` : "none registered"}`);
  console.log(`Tiers:`);
  printTiers(plan);
  console.log(`Feed share: ${b.isTrial ? "0 (trial)" : plan.shareCents !== null ? `${plan.shareCents} cents per row` : "NOT SET"}`);
}

function printRefusals(refusals: string[], execute: boolean): boolean {
  if (!refusals.length) return false;
  console.log(`\n${execute ? "REFUSED" : "Would REFUSE on --execute"}:`);
  for (const r of refusals) console.log(`  - ${r}`);
  if (execute) process.exitCode = 1;
  return true;
}

async function drain() {
  let timer: NodeJS.Timeout | undefined;
  const capped = await Promise.race([
    settleLicenseBackgroundTasks().then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), DRAIN_CAP_MS);
    }),
  ]);
  clearTimeout(timer);
  if (capped) console.log(`WARN: licence background tasks still running after ${DRAIN_CAP_MS / 1000}s`);
  await pool.end();
}

async function runGrant(args: Extract<ReturnType<typeof parseActivateBundleArgs>, { mode: "grant-feed" }>) {
  const plan = await planGrant(args);
  console.log(args.execute ? "EXECUTE --grant-feed" : "DRY RUN --grant-feed (reads only; pass --execute to grant)");
  printGrant(plan);
  if (printRefusals(plan.refusals, args.execute)) return;
  if (!args.execute) {
    console.log("\nWould grant. Re-run with --execute.");
    return;
  }
  const r = await executeGrant(plan);
  console.log(`\nGRANTED on ${r.serverName} (${r.declaredIp})`);
  for (const s of r.stamped) console.log(`  stamped  ${s.tierKey.padEnd(12)}  ${s.outcome.padEnd(11)}  ${s.subscriptionId}`);
  for (const c of r.covered) console.log(`  covered  ${c.tierKey.padEnd(12)}  (held separately, not stamped)  ${c.subscriptionId}`);
}

async function runActivate(args: Extract<ReturnType<typeof parseActivateBundleArgs>, { mode: "activate" }>) {
  const plan = await planActivation(args);
  console.log(args.execute ? "EXECUTE" : "DRY RUN (reads only; pass --execute to activate)");
  printActivation(plan);
  if (printRefusals(plan.refusals, args.execute)) return;
  if (!args.execute) {
    console.log("\nWould activate. Re-run with --execute.");
    return;
  }

  let outcome: Awaited<ReturnType<typeof executeActivation>>;
  try {
    outcome = await executeActivation(plan);
  } catch (err) {
    console.log(
      `\nERROR during execute: ${(err as Error).message}\n` +
        `The bundle may already exist and the later steps may not have run. Check /admin/users/${plan.user.id} and the basket row before anything else; ` +
        `a re-run will refuse on the active bundle or licence.`
    );
    process.exitCode = 1;
    return;
  }
  const { result, delivery, sendError, basketMarked } = outcome;
  console.log(
    `\nACTIVATED  bundle ${result.bundleId}  licence ${result.licenseId}  HH${result.licenseNumber}  key ${maskLicenseKey(result.licenseKey)}  expires ${new Date(result.expiresAt).toISOString()}  (${result.outcome})`
  );
  console.log(`Payment:   ${result.paymentId ?? "none (trial)"}`);
  if (sendError) {
    console.log(`KEY SEND THREW (${sendError.name}): the key may NOT have reached the client. Its license_key_delivery row records it.`);
    process.exitCode = 1;
  } else {
    console.log(`Key sent by ${delivery}.`);
  }
  console.log(`admin_actions bundle_activate written.`);
  console.log(`Basket:    ${basketMarked ? "marked handled" : "NOT changed: it was no longer 'new'"}`);
  console.log(`Next, once a server is registered on HH${result.licenseNumber}: npx tsx scripts/activate-bundle.mts --grant-feed ${result.bundleId}`);
  console.error(`Check stderr: a "sendTelegramMessage failed" or "sendEmail failed" line means the key did NOT reach the client. The outcome is also in admin_actions, action_type license_key_delivery.`);
}

async function main() {
  const args = parseActivateBundleArgs(process.argv.slice(2));
  if (missingEnv().includes("NEON_DATABASE_URL")) throw new RefusedError("NEON_DATABASE_URL is not set; nothing can be read");
  if (args.mode === "grant-feed") await runGrant(args);
  else await runActivate(args);
}

try {
  await main();
} catch (err) {
  if (err instanceof UsageError) console.log(`${err.message}\nUsage: ${USAGE}`);
  else if (err instanceof RefusedError) console.log(`REFUSED: ${err.message}`);
  else console.log(`ERROR: ${(err as Error).stack ?? err}`);
  process.exitCode = 1;
} finally {
  await drain();
}
