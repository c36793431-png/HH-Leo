"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";
import type { StrategyKey, SetfileSource } from "@/lib/setfiles";

const STRATEGY_OPTIONS: { value: StrategyKey; label: string }[] = [
  { value: "1leg", label: "1-Leg" },
  { value: "2leg_lock", label: "2-Leg Lock" },
  { value: "trend_impulse", label: "Trend Impulse" },
  { value: "obi", label: "OBI" },
  { value: "grid", label: "Grid" },
];

interface EditSetfileFormProps {
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  id?: string;
  mode: "create" | "edit";
  defaults?: {
    strategyKey: StrategyKey;
    source: SetfileSource;
    name: string;
    subtitle: string;
    explanation: string;
    params: string;
    sessionWindow: string | null;
    warnings: string | null;
  };
}

const inputClass = "mt-1 w-full rounded border border-zinc-700 bg-black/40 px-1.5 py-0.5 text-xs text-zinc-200";

export function EditSetfileForm({ action, id, mode, defaults }: EditSetfileFormProps) {
  const [state, formAction, isPending] = useActionState(action, null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (state === null) return;
    if (state.ok) {
      emitToast(mode === "create" ? "Setfile created" : "Setfile updated", "success");
      if (detailsRef.current) detailsRef.current.open = false;
    } else {
      emitToast(state.error, "error");
    }
  }, [state, mode]);

  return (
    <details ref={detailsRef}>
      <summary className="cursor-pointer select-none rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300">
        {mode === "create" ? "Add strategy" : "Edit"}
      </summary>
      <form action={formAction} className="mt-2 flex flex-col gap-2 rounded border border-zinc-800 bg-black/60 p-3">
        {id && <input type="hidden" name="id" value={id} />}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-zinc-500">
            Strategy
            <select name="strategyKey" defaultValue={defaults?.strategyKey ?? "1leg"} className={inputClass}>
              {STRATEGY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-zinc-500">
            Source
            <select name="source" defaultValue={defaults?.source ?? "example"} className={inputClass}>
              <option value="verified">Verified</option>
              <option value="example">Example</option>
            </select>
          </label>
        </div>
        <label className="text-[11px] text-zinc-500">
          Name
          <input type="text" name="name" defaultValue={defaults?.name ?? ""} required className={inputClass} />
        </label>
        <label className="text-[11px] text-zinc-500">
          Subtitle
          <input type="text" name="subtitle" defaultValue={defaults?.subtitle ?? ""} required className={inputClass} />
        </label>
        <label className="text-[11px] text-zinc-500">
          Explanation
          <textarea name="explanation" defaultValue={defaults?.explanation ?? ""} rows={3} className={inputClass} />
        </label>
        <label className="text-[11px] text-zinc-500">
          Params (one <code>param = value — meaning</code> per line)
          <textarea name="params" defaultValue={defaults?.params ?? ""} rows={5} className={inputClass} />
        </label>
        <label className="text-[11px] text-zinc-500">
          Session window (optional)
          <input type="text" name="sessionWindow" defaultValue={defaults?.sessionWindow ?? ""} className={inputClass} />
        </label>
        <label className="text-[11px] text-zinc-500">
          Warnings (optional)
          <textarea name="warnings" defaultValue={defaults?.warnings ?? ""} rows={2} className={inputClass} />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded bg-emerald-500/90 px-2 py-1 text-xs font-medium text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Working…" : "Save"}
        </button>
        {state && !state.ok && <p className="text-xs text-red-400">{state.error}</p>}
      </form>
    </details>
  );
}
