"use client";

import { useActionState } from "react";
import { createFeedBoxAction, issueBoxTokenAction, type IssueTokenResult } from "./actions";
import type { ActionResult } from "@/lib/action-result";

export function CreateBoxForm({ tiers }: { tiers: { id: string; tierKey: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createFeedBoxAction, null);
  return (
    <form action={action} className="space-y-3 text-sm">
      <label className="block">
        <span className="text-xs text-zinc-500">Box name (lowercase, digits, -)</span>
        <input name="name" required pattern="[a-z0-9][a-z0-9\-]{1,39}" className="mt-1 block w-64 rounded border border-zinc-700 bg-zinc-900 px-2 py-1" />
      </label>
      <fieldset>
        <legend className="text-xs text-zinc-500">Tiers this box serves</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {tiers.map((t) => (
            <label key={t.id} className="flex items-center gap-1.5">
              <input type="checkbox" name="tier" value={t.id} /> {t.name} <span className="text-zinc-500">({t.tierKey})</span>
            </label>
          ))}
        </div>
      </fieldset>
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
