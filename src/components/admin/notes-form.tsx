"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

interface NotesFormProps {
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  userId: string;
  value: string;
}

/** Freeform admin notes textarea on /admin/users/[id] — same pending/toast contract as
 * InlineEditField, but always-editable (not a click-to-open toggle) since it's its own
 * section rather than an inline profile field. */
export function NotesForm({ action, userId, value }: NotesFormProps) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  const [isPending, startTransition] = useTransition();
  const dirty = draft !== saved;

  function handleSave() {
    const formData = new FormData();
    formData.append("userId", userId);
    formData.append("notes", draft);

    startTransition(async () => {
      const result = await action(null, formData);
      if (result.ok) {
        setSaved(draft);
        emitToast("Notes saved", "success");
      } else {
        emitToast(result.error, "error");
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSave();
      }}
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={isPending}
        rows={4}
        placeholder="No notes yet — add internal context about this user…"
        className="w-full rounded border border-zinc-700 bg-black/40 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 disabled:opacity-50"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending || !dirty}
          className="rounded border border-zinc-700 px-2 py-1 text-xs text-emerald-400 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save notes"}
        </button>
        {dirty && !isPending && (
          <button
            type="button"
            onClick={() => setDraft(saved)}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            Discard changes
          </button>
        )}
      </div>
    </form>
  );
}
