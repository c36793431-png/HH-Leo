"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { DURATION_PRESETS, DURATION_UNITS, type DurationUnit } from "@/lib/duration";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

const inputClass = "rounded border border-zinc-700 bg-black/40 px-1.5 py-0.5 text-xs text-zinc-200";
const toggleClass = (active: boolean) =>
  active ? "text-cyan-300" : "text-zinc-500 hover:text-zinc-300";

interface DurationControlsProps {
  showExtendFrom?: boolean;
  defaultAmount?: number;
  defaultUnit?: DurationUnit;
}

function DurationControls({ showExtendFrom, defaultAmount = 30, defaultUnit = "days" }: DurationControlsProps) {
  const [mode, setMode] = useState<"duration" | "absolute">("duration");
  const [amount, setAmount] = useState(defaultAmount);
  const [unit, setUnit] = useState<DurationUnit>(defaultUnit);
  const [absoluteLocal, setAbsoluteLocal] = useState("");

  const absoluteIso =
    absoluteLocal && !Number.isNaN(new Date(absoluteLocal).getTime())
      ? new Date(absoluteLocal).toISOString()
      : "";

  return (
    <>
      <input type="hidden" name="mode" value={mode} />
      <div className="flex gap-2 text-[11px]">
        <button type="button" onClick={() => setMode("duration")} className={toggleClass(mode === "duration")}>
          Duration
        </button>
        <span className="text-zinc-700">·</span>
        <button type="button" onClick={() => setMode("absolute")} className={toggleClass(mode === "absolute")}>
          Absolute date
        </button>
      </div>
      {mode === "duration" ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            name="amount"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
            className={`w-16 ${inputClass}`}
          />
          <select name="unit" value={unit} onChange={(e) => setUnit(e.target.value as DurationUnit)} className={inputClass}>
            {DURATION_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-1">
            {DURATION_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setAmount(p.amount);
                  setUnit(p.unit);
                }}
                className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-400 hover:border-cyan-500 hover:text-cyan-300"
              >
                {p.label}
              </button>
            ))}
          </div>
          {showExtendFrom && (
            <select name="extendFrom" defaultValue="current" className={inputClass}>
              <option value="current">extend from current expiry</option>
              <option value="now">extend from now</option>
            </select>
          )}
        </div>
      ) : (
        <input
          type="datetime-local"
          value={absoluteLocal}
          onChange={(e) => setAbsoluteLocal(e.target.value)}
          required
          className={inputClass}
        />
      )}
      <input type="hidden" name="absoluteExpiresAt" value={absoluteIso} />
    </>
  );
}

interface DurationFormProps extends DurationControlsProps {
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  hiddenFields?: Record<string, string>;
  submitLabel: string;
  successMessage: string;
  compact?: boolean;
  triggerLabel?: string;
  triggerClassName?: string;
  children?: React.ReactNode;
}

/** Flexible license-duration picker (Mode A: amount+unit+presets, Mode B: absolute date) reused by
 * pre-provision, issue, and extend flows across /admin, /admin/users, and /admin/licenses. */
export function DurationForm({
  action,
  hiddenFields = {},
  submitLabel,
  successMessage,
  showExtendFrom,
  defaultAmount,
  defaultUnit,
  compact,
  triggerLabel,
  triggerClassName,
  children,
}: DurationFormProps) {
  const [state, formAction, isPending] = useActionState(action, null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (state === null) return;
    if (state.ok) {
      emitToast(successMessage, "success");
      if (detailsRef.current) detailsRef.current.open = false;
    } else {
      emitToast(state.error, "error");
    }
  }, [state, successMessage]);

  const form = (
    <form action={formAction} className="flex flex-wrap items-end gap-2 rounded border border-zinc-800 bg-black/60 p-2">
      {Object.entries(hiddenFields).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      {children}
      <DurationControls showExtendFrom={showExtendFrom} defaultAmount={defaultAmount} defaultUnit={defaultUnit} />
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-emerald-500/90 px-2 py-1 text-xs font-medium text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Working…" : submitLabel}
      </button>
      {state && !state.ok && <p className="w-full text-xs text-red-400">{state.error}</p>}
    </form>
  );

  if (!compact) return form;

  return (
    <details ref={detailsRef}>
      <summary
        className={
          triggerClassName ??
          "cursor-pointer select-none rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
        }
      >
        {triggerLabel}
      </summary>
      <div className="mt-2">{form}</div>
    </details>
  );
}
