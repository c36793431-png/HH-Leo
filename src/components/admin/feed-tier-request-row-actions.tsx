"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

interface FeedTierRequestRowActionsProps {
  requestId: string;
  approveAction: Action;
  rejectAction: Action;
}

/** Approve/reject pair for one /admin/feed-tier-requests row -- reject prompts for an
 * optional reason (forwarded to the client's decline DM), approve is one click. */
export function FeedTierRequestRowActions({ requestId, approveAction, rejectAction }: FeedTierRequestRowActionsProps) {
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  function approve() {
    const formData = new FormData();
    formData.append("id", requestId);
    startTransition(async () => {
      const result = await approveAction(null, formData);
      emitToast(result.ok ? "Approved" : result.error, result.ok ? "success" : "error");
    });
  }

  function reject() {
    const formData = new FormData();
    formData.append("id", requestId);
    formData.append("reason", reason);
    startTransition(async () => {
      const result = await rejectAction(null, formData);
      emitToast(result.ok ? "Rejected" : result.error, result.ok ? "success" : "error");
      if (result.ok) setRejecting(false);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={pending}
          className="rounded border border-emerald-600/50 px-2 py-0.5 text-[11px] text-emerald-400 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => setRejecting((v) => !v)}
          disabled={pending}
          className="rounded border border-red-600/50 px-2 py-0.5 text-[11px] text-red-400 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {rejecting && (
        <div className="flex flex-col gap-1">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
            rows={2}
            placeholder="Reason (optional)…"
            className="w-48 rounded border border-zinc-700 bg-black/40 px-1.5 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={reject}
            disabled={pending}
            className="self-start rounded border border-red-600/50 px-2 py-0.5 text-[11px] text-red-400 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Submitting…" : "Confirm reject"}
          </button>
        </div>
      )}
    </div>
  );
}
