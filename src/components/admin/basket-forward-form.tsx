"use client";

import { useActionState } from "react";
import { forwardBasketFeedLinesAction, type ForwardBasketState } from "@/app/admin/basket-requests/actions";
import type { ForwardOutcome, ForwardServer } from "@/lib/basket-forward";

const OUTCOME_STYLES: Record<ForwardOutcome, string> = {
  forwarded: "text-emerald-300",
  already_pending: "text-zinc-300",
  already_live: "text-zinc-300",
  no_server: "text-amber-300",
  not_picked: "text-amber-300",
  failed: "text-red-400",
};

/** The per-basket "Forward feed lines to providers" control (marcus m59987). Server rule: one
 * registered server is used as is; several = a checkbox per server on each feed line; none = no
 * button, the line says the client must register a server. */
export function BasketForwardForm({
  requestId,
  feedLines,
  servers,
}: {
  requestId: string;
  feedLines: { key: string; name: string }[];
  servers: ForwardServer[];
}) {
  const [state, formAction, isPending] = useActionState<ForwardBasketState, FormData>(forwardBasketFeedLinesAction, null);
  const label = (s: ForwardServer) => (s.serverName ? `${s.serverName} (${s.declaredIp})` : s.declaredIp);

  if (servers.length === 0) {
    return <p className="text-xs text-amber-300">Feed lines: client must register a server before they can be forwarded.</p>;
  }

  return (
    <form action={formAction} className="max-w-3xl space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <input type="hidden" name="id" value={requestId} />
      {servers.length === 1 ? (
        <p className="text-xs text-zinc-400">
          Server: <span className="text-zinc-200">{label(servers[0])}</span>
        </p>
      ) : (
        feedLines.map((l) => (
          <fieldset key={l.key} className="text-xs text-zinc-400">
            <legend className="text-zinc-300">{l.name}: pick the server(s)</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {servers.map((s) => (
                <label key={s.id} className="inline-flex items-center gap-1.5">
                  <input type="checkbox" name={`pick:${l.key}`} value={s.id} className="accent-cyan-400" />
                  <span className="text-zinc-200">{label(s)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))
      )}
      <button
        type="submit"
        disabled={isPending}
        className="whitespace-nowrap rounded border border-cyan-500/50 px-2 py-1 text-xs text-cyan-300 hover:border-cyan-400 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Forwarding…" : "Forward feed lines to providers"}
      </button>
      {state && !state.ok && <p className="text-xs text-red-400">{state.error}</p>}
      {state?.ok && (
        <ul className="space-y-0.5 text-xs">
          {state.results.map((r, i) => (
            <li key={`${r.key}:${r.server ?? ""}:${i}`} className={OUTCOME_STYLES[r.outcome]}>
              <span className="text-zinc-200">{r.name}:</span> {r.message}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
