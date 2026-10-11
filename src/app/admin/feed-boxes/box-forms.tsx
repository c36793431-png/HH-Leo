"use client";

import { useActionState } from "react";
import {
  createFeedBoxAction,
  issueBoxTokenAction,
  revokeBoxTokenAction,
  revokeRecordAction,
  setStatusTiersAction,
  type IssueTokenResult,
} from "./actions";
import type { ActionResult } from "@/lib/action-result";

type Tier = { id: string; tierKey: string; name: string };

function TierChecks({ tiers, name, legend, checked }: { tiers: Tier[]; name: string; legend: string; checked?: Set<string> }) {
  return (
    <fieldset>
      <legend className="text-xs text-zinc-500">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-3">
        {tiers.map((t) => (
          <label key={t.id} className="flex items-center gap-1.5">
            <input type="checkbox" name={name} value={t.id} defaultChecked={checked?.has(t.id)} /> {t.name}{" "}
            <span className="text-zinc-500">({t.tierKey})</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Two tier sets (Fable m64547 S1): the allowlist set (client IPs this box applies) and the status set (feeds it
 * reports on). A status-only box, like a measuring monitor, ticks only the second and gets an empty allowlist. */
export function CreateBoxForm({ tiers }: { tiers: Tier[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createFeedBoxAction, null);
  return (
    <form action={action} className="space-y-3 text-sm">
      <label className="block">
        <span className="text-xs text-zinc-500">Box name (lowercase, digits, -)</span>
        <input name="name" required pattern="[a-z0-9][a-z0-9\-]{1,39}" className="mt-1 block w-64 rounded border border-zinc-700 bg-zinc-900 px-2 py-1" />
      </label>
      <TierChecks tiers={tiers} name="tier" legend="Applies client IPs for (set once, at creation)" />
      <TierChecks tiers={tiers} name="statusTier" legend="Reports feed status for" />
      <button type="submit" disabled={pending} className="rounded border border-cyan-500/50 px-3 py-1 text-cyan-300 hover:bg-cyan-500/10">
        {pending ? "Creating…" : "Create box"}
      </button>
      {state && !state.ok && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  );
}

/** The token appears here once, after the click, and is gone on the next page load. Rotating replaces the old one
 * at once, so the box stops authenticating until the new token is pasted there. */
export function IssueTokenButton({ boxId, hasToken }: { boxId: string; hasToken: boolean }) {
  const [state, action, pending] = useActionState<IssueTokenResult, FormData>(issueBoxTokenAction, null);
  return (
    <div className="text-xs">
      <form
        action={action}
        onSubmit={(e) => {
          if (hasToken && !confirm("Rotate the token? The box stops authenticating until the new token is installed on it.")) e.preventDefault();
        }}
      >
        <input type="hidden" name="boxId" value={boxId} />
        <button type="submit" disabled={pending} className="rounded border border-amber-500/50 px-2 py-0.5 text-amber-300 hover:bg-amber-500/10">
          {pending ? "Issuing…" : hasToken ? "Rotate token" : "Issue token"}
        </button>
      </form>
      {state?.ok && (
        <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 p-2">
          <div className="font-medium text-amber-300">Token for {state.name}: copy it now, it is shown only once.</div>
          <code className="mt-1 block select-all break-all text-zinc-200">{state.token}</code>
        </div>
      )}
      {state && !state.ok && <p className="mt-1 text-red-400">{state.error}</p>}
    </div>
  );
}

/** The only tier set editable after creation (Fable m64547 S1). Unticking a tier drops what the box last reported
 * for it. */
export function StatusTiersForm({ boxId, tiers, current }: { boxId: string; tiers: Tier[]; current: string[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(setStatusTiersAction, null);
  return (
    <form action={action} className="mt-3 space-y-2 text-xs">
      <input type="hidden" name="boxId" value={boxId} />
      <TierChecks tiers={tiers} name="statusTier" legend="Reports feed status for" checked={new Set(current)} />
      <button type="submit" disabled={pending} className="rounded border border-cyan-500/50 px-2 py-0.5 text-cyan-300 hover:bg-cyan-500/10">
        {pending ? "Saving…" : "Save status tiers"}
      </button>
      {state && !state.ok && <span className="ml-2 text-red-400">{state.error}</span>}
    </form>
  );
}

/** Revoke the box's token: it stops authenticating at once, on both endpoints. Issue token makes a new one. */
export function RevokeTokenButton({ boxId }: { boxId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(revokeBoxTokenAction, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Revoke the token? The box stops authenticating at once, until a new token is issued and installed on it.")) e.preventDefault();
      }}
      className="mt-1 text-xs"
    >
      <input type="hidden" name="boxId" value={boxId} />
      <button type="submit" disabled={pending} className="rounded border border-red-500/50 px-2 py-0.5 text-red-300 hover:bg-red-500/10">
        {pending ? "Revoking…" : "Revoke token"}
      </button>
      {state && !state.ok && <p className="mt-1 text-red-400">{state.error}</p>}
    </form>
  );
}

/** Revoke one open record now. A reason is required; it goes to the audit row (/admin/history) and this row's state. */
export function RevokeRecordForm({ boxId, recordId, ip }: { boxId: string; recordId: string; ip: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(revokeRecordAction, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Revoke ${ip}? The box removes it on its next poll. The subscription itself is not changed.`)) e.preventDefault();
      }}
      className="flex items-center gap-1.5"
    >
      <input type="hidden" name="boxId" value={boxId} />
      <input type="hidden" name="recordId" value={recordId} />
      <input
        name="reason"
        required
        maxLength={300}
        placeholder="reason"
        className="w-36 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5"
      />
      <button type="submit" disabled={pending} className="rounded border border-red-500/50 px-2 py-0.5 text-red-300 hover:bg-red-500/10">
        {pending ? "Revoking…" : "Revoke now"}
      </button>
      {state && !state.ok && <span className="text-red-400">{state.error}</span>}
    </form>
  );
}
