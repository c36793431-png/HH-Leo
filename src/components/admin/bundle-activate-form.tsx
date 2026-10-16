"use client";

import { useActionState, useState } from "react";
import { activateBundleAction } from "@/app/admin/basket-requests/actions";
import type { BundleActivateState } from "@/lib/admin-bundle-activate";
import type { ActivationRefusalCode } from "@/lib/activate-bundle-cli";
import { activateDisabled, refusalText } from "@/lib/bundle-activate-ui";

/** The two refusals an admin may override, each by its own tickbox, shown only beside its refusal (plan m70272). */
const OVERRIDES: { code: ActivationRefusalCode; name: string; label: string }[] = [
  { code: "repeat_trial", name: "allowRepeatTrial", label: "Issue another trial anyway" },
  { code: "internal", name: "allowInternal", label: "Activate for this internal / test account anyway" },
];

/** "Activate bundle…" on a New basket request with a bundle line (Bundles S3). The bundle and its feed come from the
 * basket line, shown fixed (Fable C7: the server refuses any other feed, so a picker would be a trap). Trial only:
 * Paid is disabled until the paid-group invite (N1) is built, and the server refuses it too. The titles arrive as
 * props: no catalogue value-import in a client file (bundle-s2.test.tsx T8 C1). */
export function BundleActivateForm({
  requestId,
  userId,
  bundleKey,
  bundleTitle,
  feedChoice,
  feedTitle,
}: {
  requestId: string;
  userId: string;
  bundleKey: string;
  bundleTitle: string;
  feedChoice: string;
  feedTitle: string;
}) {
  const [state, formAction, isPending] = useActionState<BundleActivateState, FormData>(activateBundleAction, null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const refused = new Set(state?.kind === "plan" ? state.refusals.map((r) => r.code) : []);

  if (state?.kind === "done") {
    const r = state.result;
    return (
      <div className="max-w-3xl space-y-1 rounded-lg border border-emerald-500/40 bg-zinc-950/40 p-3 text-xs text-zinc-300" data-bundle-activate-result>
        <p className="text-emerald-300">
          Activated: HH{r.hh} · key {r.maskedKey} · expires {r.expiresAt} ({r.outcome})
        </p>
        <KeySendLine keySend={r.keySend} />
        <p>admin_actions bundle_activate written.</p>
        <p>{r.basketMarked ? "Basket marked handled." : "Basket NOT changed: it was no longer 'new'."}</p>
      </div>
    );
  }

  return (
    <details className="max-w-3xl rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-300" data-bundle-activate={requestId}>
      <summary className="cursor-pointer text-cyan-300">Activate bundle…</summary>
      <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="id" value={requestId} />
        <input type="hidden" name="user" value={userId} />
        <input type="hidden" name="bundle" value={bundleKey} />
        <input type="hidden" name="feed" value={feedChoice} />
        <p>
          {bundleTitle} · feed <span className="text-zinc-100">{feedTitle}</span> <span className="text-zinc-500">(from the basket line)</span>
        </p>
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <legend className="sr-only">Trial or paid</legend>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name="trial" value="1" className="accent-cyan-400" />
            Trial
          </label>
          <label className="inline-flex items-center gap-1.5 text-zinc-500">
            <input type="radio" name="trial" value="0" disabled />
            Paid (needs the paid-group invite, N1)
          </label>
        </fieldset>
        <label className="flex items-center gap-2">
          Days
          <input name="days" type="number" min={1} max={90} step={1} inputMode="numeric" className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100" />
          <span className="text-zinc-500">1 to 90, no default</span>
        </label>

        {state?.kind === "error" && <p className="text-red-400">{state.error}</p>}
        {state?.kind === "plan" && (
          <div className="space-y-2" data-bundle-activate-plan>
            <CheckFacts check={state.check} />
            {state.refusals.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-4 text-amber-300">
                {state.refusals.map((r) => (
                  <li key={r.code + r.text}>{refusalText(r.text)}</li>
                ))}
              </ul>
            ) : (
              <p className="text-emerald-300">No refusals: Activate is ready.</p>
            )}
          </div>
        )}
        {OVERRIDES.filter((o) => refused.has(o.code) || ticked[o.name]).map((o) => (
          <label key={o.name} className="flex items-center gap-1.5 text-amber-200">
            <input
              type="checkbox"
              name={o.name}
              value="1"
              checked={ticked[o.name] ?? false}
              onChange={(e) => setTicked((t) => ({ ...t, [o.name]: e.target.checked }))}
              className="accent-amber-400"
            />
            {o.label}
          </label>
        ))}

        <div className="flex gap-2">
          <button
            type="submit"
            name="mode"
            value="check"
            disabled={isPending}
            className="rounded border border-zinc-600 px-2 py-1 text-zinc-200 hover:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Check
          </button>
          <button
            type="submit"
            name="mode"
            value="activate"
            disabled={activateDisabled(isPending, state)}
            className="rounded border border-cyan-500/50 px-2 py-1 text-cyan-300 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Activate
          </button>
        </div>
      </form>
    </details>
  );
}

/** A refused send does not throw (Resend 422 returns ok:false), so the line reads keySend.ok, never "no error". */
export function KeySendLine({ keySend }: { keySend: { ok: boolean; channel: string; error: string | null } }) {
  return keySend.ok ? (
    <p>Key sent by {keySend.channel}.</p>
  ) : (
    <p className="text-red-400">
      Key NOT delivered ({keySend.channel}: {keySend.error}), unreachable alert raised. See admin_actions license_key_delivery.
    </p>
  );
}

function CheckFacts({ check }: { check: Extract<BundleActivateState, { kind: "plan" }>["check"] }) {
  const c = check;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
      <dt className="text-zinc-500">User</dt>
      <dd>
        {c.user.displayName ?? c.user.email ?? c.user.id} {c.user.email ? `· ${c.user.email}` : ""} · Telegram {c.user.telegram ? "yes" : "no"}
        {c.user.internal ? " · INTERNAL" : ""}
      </dd>
      <dt className="text-zinc-500">Licences</dt>
      <dd>
        {c.licences.length === 0
          ? "none"
          : c.licences.map((l) => `HH${l.number} ${l.tier} ${l.status}${l.live ? " LIVE" : ""} (to ${l.expiresAt.slice(0, 10)})`).join("; ")}
      </dd>
      <dt className="text-zinc-500">Bundle</dt>
      <dd>{c.activeBundle ? `ACTIVE ${c.activeBundle.bundleKey} (${c.activeBundle.feedChoice})` : "none active"}</dd>
      <dt className="text-zinc-500">Basket</dt>
      <dd>{c.basket ? `${c.basket.status} · bundle line ${c.basket.bundleLine ?? "NONE"}` : "NOT FOUND"}</dd>
      <dt className="text-zinc-500">Feed tiers</dt>
      <dd>{c.tiers.map((t) => `${t.name ?? t.tierKey}${t.hasProvider ? "" : " (no provider)"}`).join(", ")} (granted later, once a server is registered)</dd>
      <dt className="text-zinc-500">Key by</dt>
      <dd>{c.delivery}</dd>
      <dt className="text-zinc-500">Writes</dt>
      <dd>
        trial licence {c.days} days, the bundle row, the key send, admin_actions {c.adminRow}, the basket to handled
      </dd>
      <dt className="text-zinc-500">Message</dt>
      <dd className="whitespace-pre-wrap text-zinc-400">
        {c.subject}
        {"\n"}
        {c.maskedMessage}
      </dd>
    </dl>
  );
}
