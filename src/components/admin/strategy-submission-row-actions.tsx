"use client";

import { useState, useTransition } from "react";
import { STRATEGY_SUBMISSION_STATUSES, type StrategySubmissionStatus } from "@/lib/strategy-submissions";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

interface StrategySubmissionRowActionsProps {
  strategySubmissionId: string;
  status: StrategySubmissionStatus;
  notes: string;
  setStatusAction: Action;
  setNotesAction: Action;
}

/** Inline status dropdown (auto-submits) + notes textarea (explicit save) for one
 * /admin/strategy-submissions row — mirrors StrategyRequestRowActions. */
export function StrategySubmissionRowActions({
  strategySubmissionId,
  status,
  notes,
  setStatusAction,
  setNotesAction,
}: StrategySubmissionRowActionsProps) {
  const [statusPending, startStatusTransition] = useTransition();
  const [notesPending, startNotesTransition] = useTransition();
  const [draftNotes, setDraftNotes] = useState(notes);
  const [savedNotes, setSavedNotes] = useState(notes);
  const dirty = draftNotes !== savedNotes;

  function handleStatusChange(next: string) {
    const formData = new FormData();
    formData.append("id", strategySubmissionId);
    formData.append("status", next);
    startStatusTransition(async () => {
      const result = await setStatusAction(null, formData);
      emitToast(result.ok ? "Status updated" : result.error, result.ok ? "success" : "error");
    });
  }

  function handleNotesSave() {
    const formData = new FormData();
    formData.append("id", strategySubmissionId);
    formData.append("notes", draftNotes);
    startNotesTransition(async () => {
      const result = await setNotesAction(null, formData);
      if (result.ok) {
        setSavedNotes(draftNotes);
        emitToast("Notes saved", "success");
      } else {
        emitToast(result.error, "error");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <select
        defaultValue={status}
        disabled={statusPending}
        onChange={(e) => handleStatusChange(e.target.value)}
        className="rounded border border-zinc-700 bg-black/40 px-1.5 py-0.5 text-xs text-zinc-200 disabled:opacity-50"
      >
        {STRATEGY_SUBMISSION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <textarea
        value={draftNotes}
        onChange={(e) => setDraftNotes(e.target.value)}
        disabled={notesPending}
        rows={2}
        placeholder="Notes…"
        className="w-48 rounded border border-zinc-700 bg-black/40 px-1.5 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 disabled:opacity-50"
      />
      {dirty && (
        <button
          type="button"
          onClick={handleNotesSave}
          disabled={notesPending}
          className="self-start rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-emerald-400 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {notesPending ? "Saving…" : "Save notes"}
        </button>
      )}
    </div>
  );
}
