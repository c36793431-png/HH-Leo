"use client";

import { useActionState, useEffect } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

interface ActionButtonProps {
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  hiddenFields?: Record<string, string>;
  label: string;
  successMessage: string;
  className?: string;
}

/** Single-button admin mutation (revoke, expire-now, resend, force-remove) — same
 * success/error/toast contract as DurationForm so no admin action can crash to
 * Next's generic error page and leave the operator guessing whether it landed. */
export function ActionButton({ action, hiddenFields = {}, label, successMessage, className }: ActionButtonProps) {
  const [state, formAction, isPending] = useActionState(action, null);

  useEffect(() => {
    if (state === null) return;
    emitToast(state.ok ? successMessage : state.error, state.ok ? "success" : "error");
  }, [state, successMessage]);

  return (
    <form action={formAction}>
      {Object.entries(hiddenFields).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <button
        type="submit"
        disabled={isPending}
        className={
          className ??
          "rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-amber-500 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        {isPending ? "Working…" : label}
      </button>
    </form>
  );
}
