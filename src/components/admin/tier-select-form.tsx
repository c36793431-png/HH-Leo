"use client";

import { useActionState, useEffect, useRef } from "react";
import { LICENSE_TIERS } from "@/lib/licenses";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

interface TierSelectFormProps {
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  hiddenFields?: Record<string, string>;
  currentTier: string;
}

/** Inline tier dropdown — auto-submits on change, same success/error toast contract as
 * ActionButton/DurationForm, so coxwell can flip a license's tier without touching SQL. */
export function TierSelectForm({ action, hiddenFields = {}, currentTier }: TierSelectFormProps) {
  const [state, formAction, isPending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state === null) return;
    emitToast(state.ok ? "Tier updated" : state.error, state.ok ? "success" : "error");
  }, [state]);

  return (
    <form ref={formRef} action={formAction}>
      {Object.entries(hiddenFields).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <select
        name="tier"
        defaultValue={currentTier}
        disabled={isPending}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded border border-zinc-700 bg-black/40 px-1.5 py-0.5 text-xs text-zinc-200 disabled:opacity-50"
      >
        {LICENSE_TIERS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </form>
  );
}
