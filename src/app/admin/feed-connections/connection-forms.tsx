"use client";

import { useActionState } from "react";
import { setFeedTierConnectionAction } from "./actions";
import type { ActionResult } from "@/lib/action-result";
import { CONN_TYPES, CONN_TYPE_LABELS, MAX_SYMBOLS, type ConnType } from "@/lib/feed-connections";

type Tier = { id: string; tierKey: string; name: string };

/** What the form starts with: a stored row (the edit form) or nothing (the new-connection form). */
export interface ConnectionDefaults {
  feedTierId: string;
  connType: ConnType;
  host: string;
  port: number;
  dataType: string | null;
  sessionHours: string | null;
  symbolsText: string;
}

const INPUT = "mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200";

/** One form for both cases. Saving replaces the whole row for that (tier, type), audited in the same write (Fable N2).
 * Fable N1: a symbol line needs a description. N4: the host check takes hostnames and IPv4 only. */
export function ConnectionForm({ tiers, row }: { tiers?: Tier[]; row?: ConnectionDefaults }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(setFeedTierConnectionAction, null);
  return (
    <form action={action} className="space-y-3 text-sm">
      {row ? (
        <>
          <input type="hidden" name="feedTierId" value={row.feedTierId} />
          <input type="hidden" name="connType" value={row.connType} />
        </>
      ) : (
        <div className="flex flex-wrap gap-4">
          <label className="block">
            <span className="text-xs text-zinc-500">Tier</span>
            <select name="feedTierId" required className={INPUT}>
              {tiers?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.tierKey})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-zinc-500">Connection type</span>
            <select name="connType" required className={INPUT}>
              {CONN_TYPES.map((c) => (
                <option key={c} value={c}>
                  {CONN_TYPE_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        <label className="block w-64">
          <span className="text-xs text-zinc-500">Host: a hostname or IPv4 address (no IPv6, no underscores)</span>
          <input name="host" required defaultValue={row?.host ?? ""} className={`${INPUT} font-mono`} />
        </label>
        <label className="block w-28">
          <span className="text-xs text-zinc-500">Port</span>
          <input name="port" required inputMode="numeric" pattern="[0-9]{1,5}" defaultValue={row ? String(row.port) : ""} className={`${INPUT} font-mono`} />
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-zinc-500">Data type (optional), e.g. Top of book (best bid/ask)</span>
        <input name="dataType" maxLength={120} defaultValue={row?.dataType ?? ""} className={INPUT} />
      </label>
      <label className="block">
        <span className="text-xs text-zinc-500">Session hours (optional)</span>
        <input name="sessionHours" maxLength={200} defaultValue={row?.sessionHours ?? ""} className={INPUT} />
      </label>
      <label className="block">
        <span className="text-xs text-zinc-500">{`Symbols (optional): SYMBOL Description, one per line, at most ${MAX_SYMBOLS}. Example: GC.FUT Gold`}</span>
        <textarea name="symbols" rows={row && row.symbolsText ? Math.min(16, row.symbolsText.split("\n").length + 1) : 4} defaultValue={row?.symbolsText ?? ""} className={`${INPUT} font-mono text-xs`} />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded border border-cyan-500/50 px-3 py-1 text-cyan-300 hover:bg-cyan-500/10">
          {pending ? "Saving…" : row ? "Save" : "Add connection"}
        </button>
        {state?.ok && !pending && <span className="text-xs text-emerald-400">Saved</span>}
        {state && !state.ok && <span className="text-xs text-red-400">{state.error}</span>}
      </div>
    </form>
  );
}
