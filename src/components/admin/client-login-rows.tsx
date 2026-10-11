"use client";

import { useActionState } from "react";
import { setClientLoginAction } from "@/app/admin/feed-connections/actions";
import type { ActionResult } from "@/lib/action-result";
import type { ClientLoginRow } from "@/lib/feed-connections";

function ClientLoginForm({ userId, row }: { userId: string; row: ClientLoginRow }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(setClientLoginAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-xs">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="feedTierId" value={row.feedTierId} />
      <input type="hidden" name="connType" value={row.connType} />
      <span className="w-48 text-zinc-400">
        {row.tierName} <span className="text-zinc-500">· {row.label}</span>
      </span>
      <input
        name="username"
        defaultValue={row.username ?? ""}
        maxLength={32}
        pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{1,31}"
        placeholder="no username"
        className="w-40 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-200"
      />
      <button type="submit" disabled={pending} className="rounded border border-cyan-500/50 px-2 py-0.5 text-cyan-300 hover:bg-cyan-500/10">
        {pending ? "Saving…" : "Save"}
      </button>
      {state?.ok && !pending && <span className="text-emerald-400">Saved</span>}
      {state && !state.ok && <span className="text-red-400">{state.error}</span>}
    </form>
  );
}

/** /admin/users/[id]: the client's username per connection type of each tier they hold (B3-2, Fable S1). An empty
 * name clears it. Nothing else about the login is kept here. */
export function ClientLoginRows({ userId, rows }: { userId: string; rows: ClientLoginRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <ClientLoginForm key={`${row.feedTierId}:${row.connType}`} userId={userId} row={row} />
      ))}
    </div>
  );
}
