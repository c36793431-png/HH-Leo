"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

interface InlineEditFieldProps {
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  hiddenFields?: Record<string, string>;
  field: string;
  value: string;
  label: string;
  type?: string;
  options?: string[];
}

/** Inline pencil-to-edit field for admin/users/[id] Profile block — same success/error
 * toast contract as ActionButton/TierSelectForm. Calls the server action directly inside
 * a transition (rather than useActionState) so closing the editor on success is a plain
 * event-driven setState, not a setState-in-effect. */
export function InlineEditField({
  action,
  hiddenFields = {},
  field,
  value,
  label,
  type = "text",
  options,
}: InlineEditFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [displayValue, setDisplayValue] = useState(value);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const formData = new FormData();
    for (const [key, val] of Object.entries(hiddenFields)) formData.append(key, val);
    formData.append("field", field);
    formData.append("value", draft);

    startTransition(async () => {
      const result = await action(null, formData);
      if (result.ok) {
        setDisplayValue(draft);
        setEditing(false);
        emitToast(`${label} updated`, "success");
      } else {
        emitToast(result.error, "error");
      }
    });
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        <span>{displayValue || "—"}</span>
        <button
          type="button"
          onClick={() => {
            setDraft(displayValue);
            setEditing(true);
          }}
          aria-label={`Edit ${label}`}
          className="text-zinc-600 hover:text-cyan-300"
        >
          ✎
        </button>
      </span>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSave();
      }}
      className="inline-flex items-center gap-2"
    >
      {options ? (
        <select
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isPending}
          autoFocus
          className="rounded border border-zinc-700 bg-black/40 px-1.5 py-0.5 text-xs text-zinc-200 disabled:opacity-50"
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isPending}
          autoFocus
          className="rounded border border-zinc-700 bg-black/40 px-1.5 py-0.5 text-xs text-zinc-200 disabled:opacity-50"
        />
      )}
      <button
        type="submit"
        disabled={isPending}
        className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        disabled={isPending}
        className="text-xs text-zinc-500 hover:text-zinc-300"
      >
        Cancel
      </button>
    </form>
  );
}
