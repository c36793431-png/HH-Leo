import { maskLicenseKey } from "./licenses";
import { BundleAlreadyActiveError } from "./bundles";
import type { KeyDelivery } from "./issue-new-license";
import { MAX_TRIAL_DAYS } from "./agent-api";
import {
  executeActivation,
  parseActivateFields,
  planActivation,
  RefusedError,
  UsageError,
  type ActivateArgs,
  type ActivationActor,
  type ActivationOutcome,
  type ActivationPlan,
  type ActivationRefusal,
} from "./activate-bundle-cli";

/** The admin "Activate bundle…" control on /admin/basket-requests (Bundles S3, plan m70272, Fable m70330, BUILD GO
 * marcus m70329). The same planActivation / executeActivation as scripts/activate-bundle.mts, with the clicking admin
 * as the actor and via 'admin'. Trial only: Paid needs the paid-group invite first (N1, its own slice after S3b). */

/** Server-side, before anything is planned (Fable S1): the dialog's disabled Paid radio is not trusted alone. */
export const PAID_NEEDS_N1 = "Paid needs the paid-group invite (N1), which is not built yet: activate a trial, or use the CLI";

/** What Check shows: the CLI dry run's facts, never a key (the plan's message carries only the masked placeholder). */
export interface BundleActivateCheck {
  user: { id: string; email: string | null; displayName: string | null; telegram: boolean; internal: boolean };
  licences: { number: number; tier: string; status: string; live: boolean; expiresAt: string }[];
  activeBundle: { id: string; bundleKey: string; feedChoice: string } | null;
  basket: { id: string; status: string; bundleLine: string | null } | null;
  tiers: { tierKey: string; name: string | null; hasProvider: boolean }[];
  delivery: KeyDelivery;
  days: number;
  subject: string;
  maskedMessage: string;
  adminRow: string;
}

/** What Activate shows (Fable S2): the full key never leaves the server. ActivationOutcome.result carries it, so the
 * outcome is mapped field by field, never returned as is. */
export interface BundleActivateResult {
  bundleId: string;
  hh: number;
  maskedKey: string;
  expiresAt: string;
  outcome: string;
  keySend: { ok: boolean; channel: string; error: string | null };
  adminRow: true;
  basketMarked: boolean;
}

export type BundleActivateState =
  | null
  | { kind: "error"; error: string }
  | { kind: "plan"; check: BundleActivateCheck; refusals: ActivationRefusal[] }
  | { kind: "done"; result: BundleActivateResult };

export function checkView(plan: ActivationPlan): BundleActivateCheck {
  const line = plan.basket?.lines.find((l) => l.kind === "bundle");
  return {
    user: {
      id: plan.user.id,
      email: plan.user.email,
      displayName: plan.user.displayName,
      telegram: plan.user.telegramUserId !== null,
      internal: plan.user.internal,
    },
    licences: plan.licences.map((l) => ({ number: l.licenseNumber, tier: l.tier, status: l.status, live: l.live, expiresAt: l.expiresAt.toISOString() })),
    activeBundle: plan.activeBundle,
    basket: plan.basket ? { id: plan.basket.id, status: plan.basket.status, bundleLine: line ? `${line.key} (${line.feed ?? "no feed"})` : null } : null,
    tiers: plan.tiers.map((t) => ({ tierKey: t.tierKey, name: t.name, hasProvider: t.providerUserId !== null })),
    delivery: plan.delivery,
    days: plan.args.days,
    subject: plan.subject,
    maskedMessage: plan.maskedMessage,
    adminRow: plan.adminAction.action_type,
  };
}

export function resultView(out: ActivationOutcome): BundleActivateResult {
  const r = out.result;
  const keySend = out.sendError
    ? { ok: false, channel: out.delivery, error: `threw ${out.sendError.name}` }
    : out.keySend
      ? { ok: out.keySend.ok, channel: out.keySend.channel, error: out.keySend.ok ? null : out.keySend.error }
      : { ok: false, channel: out.delivery, error: "no outcome" };
  return {
    bundleId: r.bundleId,
    hh: r.licenseNumber,
    maskedKey: maskLicenseKey(r.licenseKey),
    expiresAt: new Date(r.expiresAt).toISOString(),
    outcome: r.outcome,
    keySend,
    adminRow: true,
    basketMarked: out.basketMarked,
  };
}

const field = (form: FormData, name: string): string | undefined => {
  const v = form.get(name);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};

/** Check (mode=check) or Activate (mode=activate). Both re-plan from the posted fields alone.
 *
 * "Refuses if anything changed" (Fable C2), defined: Activate posts the same fields as Check, the server plans
 * again from them and the database, and refuses iff that plan has any refusal. Every write-relevant fact is a
 * refusal there (env, actor, internal, active bundle, live licence, past trial, the basket's owner / status /
 * line, the delivery channel), so a change between Check and Activate that matters shows up as one. The client
 * never sends a plan or a plan hash, and nothing from the Check response is trusted. */
export async function runBundleActivate(actor: ActivationActor, form: FormData, env: Record<string, string | undefined> = process.env): Promise<BundleActivateState> {
  const trial = form.get("trial");
  if (trial !== "1") return { kind: "error", error: trial === "0" ? PAID_NEEDS_N1 : "Pick Trial (there is no default)" };

  const mode = form.get("mode") === "activate" ? "activate" : "check";
  let args: ActivateArgs;
  try {
    const fields = parseActivateFields(
      { user: field(form, "user"), bundle: field(form, "bundle"), feed: field(form, "feed"), days: field(form, "days"), trial: true, basket: field(form, "id") },
      { maxTrialDays: MAX_TRIAL_DAYS }
    );
    args = { mode: "activate", ...fields, allowRepeatTrial: form.get("allowRepeatTrial") === "1", allowInternal: form.get("allowInternal") === "1", execute: mode === "activate" };
  } catch (err) {
    if (err instanceof UsageError) return { kind: "error", error: err.message };
    throw err;
  }

  let plan: ActivationPlan;
  try {
    plan = await planActivation(args, { actor, via: "admin" }, env);
  } catch (err) {
    // No such user any more (Fable C5), or several: the script prints these as REFUSED too.
    if (err instanceof RefusedError) return { kind: "error", error: `Refused: ${err.message}` };
    throw err;
  }
  if (mode === "check" || plan.refusals.length) return { kind: "plan", check: checkView(plan), refusals: plan.refusals };

  let out: ActivationOutcome;
  try {
    out = await executeActivation(plan);
  } catch (err) {
    // The race the re-plan can't see: activateBundle locks the user row (bundles.ts:386) before its active-bundle
    // check (:388), so the second of two concurrent clicks throws here, before any send, admin row or basket write.
    if (err instanceof BundleAlreadyActiveError) return { kind: "error", error: "Already activated: reload" };
    if (err instanceof RefusedError) return { kind: "error", error: err.message };
    const e = err as Error;
    return {
      kind: "error",
      error: `Activation failed (${e?.name ?? "Error"}: ${e?.message ?? ""}). The bundle may exist: check /admin/users/${plan.user.id} and this basket before trying again`,
    };
  }
  return { kind: "done", result: resultView(out) };
}
