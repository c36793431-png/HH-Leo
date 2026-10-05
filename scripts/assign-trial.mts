/* Assign a client a trial licence from the command line (marcus m60729, scope m60728).
 *
 *   npx tsx scripts/assign-trial.mts --user <uuid|email> --days <N> --feeds <london,ny,...> [--allow-repeat-trial] [--allow-internal] [--execute]
 *
 * Run from the repo root, with the env in the shell (src/lib/assign-trial.ts REQUIRED_ENV).
 * DRY RUN unless --execute: reads only, and prints the user, their licence history, the expiry,
 * the delivery channel, the admin_actions row and the DM text with the key masked.
 * --execute goes through issueNewLicenseForUser, the same function as "Issue new license" on
 * /admin/users, as the marcus-agent@horizonhft.internal actor. It prints the licence id, the HH
 * number and the MASKED key; the full key is never printed.
 * Refuses on: missing env, missing actor row, no user or several, an internal or test account
 * (the actor itself included) without --allow-internal, an active licence, a past trial without
 * --allow-repeat-trial, no Telegram id and no email, an unknown feed.
 * A failed key send is a "sendTelegramMessage failed" or "sendEmail failed" line on STDERR.
 *
 * No process.exit: issueLicense's ops ping runs in the background, and exiting or ending the
 * pool under it would cut it off. The script waits for it (capped), then ends the pool. */
import {
  executeTrial,
  missingEnv,
  parseAssignTrialArgs,
  planTrial,
  RefusedError,
  UsageError,
  USAGE,
  type TrialPlan,
} from "../src/lib/assign-trial.js";
import { maskLicenseKey, settleLicenseBackgroundTasks } from "../src/lib/licenses.js";
import { pool } from "../src/lib/db.js";

const DRAIN_CAP_MS = 15_000;

function printPlan(plan: TrialPlan) {
  const u = plan.user;
  console.log(`User:      ${u.id}  ${u.email ?? "(no email)"}  telegram ${u.telegramUserId ?? "none"}${u.displayName ? `  "${u.displayName}"` : ""}`);
  console.log(`Actor:     ${plan.actor ? `${plan.actor.id}  ${plan.actor.email}` : "MISSING"}`);
  console.log(`Licences:  ${plan.licences.length === 0 ? "none" : plan.licences.length}`);
  for (const l of plan.licences) {
    console.log(
      `  HH${l.licenseNumber}  ${l.tier.padEnd(5)}  ${l.status.padEnd(7)}  ${l.live ? "LIVE " : "     "}  issued ${l.issuedAt.toISOString()}  expires ${l.expiresAt.toISOString()}  feeds ${l.feedTypes.join(",") || "-"}`
    );
  }
  console.log(`New trial: expires ${plan.expiresAt.toISOString()}  feeds ${plan.feedTypes.join(",")}`);
  console.log(`Delivery:  ${plan.delivery}`);
  console.log(`admin_actions row: ${JSON.stringify(plan.adminAction)}`);
  console.log(`Message (${plan.subject}), key masked:\n  ${plan.maskedMessage.replace(/\n/g, "\n  ")}`);
}

/** Waits for issueLicense's background ops ping and auto-payment, capped, then ends the pool so
 * the event loop can empty on its own. */
async function drain() {
  let timer: NodeJS.Timeout | undefined;
  const capped = await Promise.race([
    settleLicenseBackgroundTasks().then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), DRAIN_CAP_MS);
    }),
  ]);
  clearTimeout(timer);
  if (capped) console.log(`WARN: background tasks still running after ${DRAIN_CAP_MS / 1000}s; the ops "trial issued" ping may not have been sent`);
  await pool.end();
}

async function main() {
  const args = parseAssignTrialArgs(process.argv.slice(2));
  if (missingEnv().includes("NEON_DATABASE_URL")) throw new RefusedError("NEON_DATABASE_URL is not set; nothing can be read");

  const plan = await planTrial(args);
  console.log(args.execute ? "EXECUTE" : "DRY RUN (reads only; pass --execute to issue)");
  printPlan(plan);

  if (plan.refusals.length) {
    console.log(`\n${args.execute ? "REFUSED" : "Would REFUSE on --execute"}:`);
    for (const r of plan.refusals) console.log(`  - ${r}`);
    if (args.execute) process.exitCode = 1;
    return;
  }
  if (!args.execute) {
    console.log("\nWould issue. Re-run with --execute.");
    return;
  }

  let result: Awaited<ReturnType<typeof executeTrial>>;
  try {
    result = await executeTrial(plan);
  } catch (err) {
    console.log(
      `\nERROR during execute: ${(err as Error).message}\n` +
        `The licence may already exist and the key may not have been sent. Check /admin/users/${plan.user.id} before anything else; ` +
        `a re-run will refuse on the active licence.`
    );
    process.exitCode = 1;
    return;
  }
  const { license, delivery } = result;
  console.log(`\nISSUED  licence ${license.id}  HH${license.licenseNumber}  key ${maskLicenseKey(license.licenseKey)}  expires ${license.expiresAt.toISOString()}`);
  console.log(`Key sent by ${delivery}.`);
  // On stderr, beside the failure lines it points at, so it shows without 2>&1.
  console.error(`Check stderr: a "sendTelegramMessage failed" or "sendEmail failed" line means the key did NOT reach the client.`);
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
