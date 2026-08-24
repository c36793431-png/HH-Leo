"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

interface TermsReviewCardActionsProps {
  proposalId: string;
  providerSplitPct: number;
  confirmAction: Action;
  declineAction: Action;
}

/** Review card's Confirm (with an optional one-off split % override -- "adjust the
 * share before confirming") and Decline (requires a private note) actions. Both are
 * terminal for this round: on success there's nothing left to act on here, so we just
 * toast and let the caller's revalidatePath refresh the queue behind this page. */
export function TermsReviewCardActions({
  proposalId,
  providerSplitPct,
  confirmAction,
  declineAction,
}: TermsReviewCardActionsProps) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overridePct, setOverridePct] = useState(String(providerSplitPct));
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declinedNote, setDeclinedNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function confirm() {
    const formData = new FormData();
    formData.append("proposalId", proposalId);
    if (overrideOpen && overridePct.trim() !== "" && Number(overridePct) !== providerSplitPct) {
      formData.append("providerSplitPctOverride", overridePct);
    }
    startTransition(async () => {
      const result = await confirmAction(null, formData);
      emitToast(result.ok ? "Confirmed" : result.error, result.ok ? "success" : "error");
      if (result.ok) setDone(true);
    });
  }

  function decline() {
    if (!declinedNote.trim()) {
      emitToast("A private note is required to decline", "error");
      return;
    }
    const formData = new FormData();
    formData.append("proposalId", proposalId);
    formData.append("declinedNote", declinedNote);
    startTransition(async () => {
      const result = await declineAction(null, formData);
      emitToast(result.ok ? "Declined — a new draft round is ready for the provider" : result.error, result.ok ? "success" : "error");
      if (result.ok) setDone(true);
    });
  }

  if (done) {
    return <p className="text-sm text-zinc-500">Decision recorded.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={pending}
          className="rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Working…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => setOverrideOpen((v) => !v)}
          disabled={pending}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          {overrideOpen ? "Cancel adjustment" : "Adjust share before confirming"}
        </button>
      </div>

      {overrideOpen && (
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Provider share for this confirm only (%)
          <input
            type="number"
            min={0}
            max={100}
            value={overridePct}
            onChange={(e) => setOverridePct(e.target.value)}
            disabled={pending}
            className="w-20 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          />
        </label>
      )}

      <div className="border-t border-zinc-800 pt-3">
        {!declineOpen ? (
          <button
            type="button"
            onClick={() => setDeclineOpen(true)}
            disabled={pending}
            className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-red-400 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Decline
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              value={declinedNote}
              onChange={(e) => setDeclinedNote(e.target.value)}
              disabled={pending}
              rows={3}
              placeholder="Private note — never shown to the provider, never emailed. Steer them on Telegram."
              className="w-full rounded border border-zinc-700 bg-black/40 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 disabled:opacity-50"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={decline}
                disabled={pending}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "Working…" : "Confirm decline"}
              </button>
              <button
                type="button"
                onClick={() => setDeclineOpen(false)}
                disabled={pending}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
            <p className="text-[11px] text-zinc-600">
              The provider sees only a generic notice and a pre-filled round for revision — no reason, ever.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
