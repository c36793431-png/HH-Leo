"use client";

import { useActionState, useEffect, useRef } from "react";
import { FEED_TYPES, FEED_TYPE_META } from "@/lib/licenses";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

/** Checkbox group reused by the issue-license form (fresh license, nothing checked) and the
 * per-license edit form below (pre-checked from the license's current feed_types). */
export function FeedCheckboxes({ defaultSelected = [] }: { defaultSelected?: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {FEED_TYPES.map((f) => (
        <label
          key={f}
          className="flex items-center gap-1.5 rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300"
        >
          <input
            type="checkbox"
            name="feedTypes"
            value={f}
            defaultChecked={defaultSelected.includes(f)}
            className="accent-cyan-500"
          />
          {FEED_TYPE_META[f].name}
        </label>
      ))}
    </div>
  );
}

interface FeedSelectFormProps {
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  hiddenFields?: Record<string, string>;
  currentFeedTypes: string[];
  triggerClassName?: string;
}

/** Compact edit-in-place control on an existing license row — admin can add/remove feeds
 * without touching the license's status/expiry/tier. */
export function FeedSelectForm({ action, hiddenFields = {}, currentFeedTypes, triggerClassName }: FeedSelectFormProps) {
  const [state, formAction, isPending] = useActionState(action, null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (state === null) return;
    emitToast(state.ok ? "Feeds updated" : state.error, state.ok ? "success" : "error");
    if (state.ok && detailsRef.current) detailsRef.current.open = false;
  }, [state]);

  return (
    <details ref={detailsRef}>
      <summary
        className={
          triggerClassName ??
          "cursor-pointer select-none rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300"
        }
      >
        Edit feeds
      </summary>
      <form
        action={formAction}
        className="mt-2 flex flex-wrap items-end gap-2 rounded border border-zinc-800 bg-black/60 p-2"
      >
        {Object.entries(hiddenFields).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <FeedCheckboxes defaultSelected={currentFeedTypes} />
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-emerald-500/90 px-2 py-1 text-xs font-medium text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Working…" : "Apply"}
        </button>
        {state && !state.ok && <p className="w-full text-xs text-red-400">{state.error}</p>}
      </form>
    </details>
  );
}
