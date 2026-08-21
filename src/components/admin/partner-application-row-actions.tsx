"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

interface PartnerApplicationRowActionsProps {
  applicationId: string;
  approveAction: Action;
  declineAction: Action;
}

/** Approve/decline pair for one /admin/partner-applications row -- decline prompts for an
 * optional reason (forwarded to the applicant's decline DM/email), same pattern as
 * FeedTierRequestRowActions. */
export function PartnerApplicationRowActions({
  applicationId,
  approveAction,
  declineAction,
}: PartnerApplicationRowActionsProps) {
  const [pending, startTransition] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  function approve() {
    const formData = new FormData();
    formData.append("id", applicationId);
    startTransition(async () => {
      const result = await approveAction(null, formData);
      emitToast(result.ok ? "Approved" : result.error, result.ok ? "success" : "error");
    });
  }

  function decline() {
    const formData = new FormData();
    formData.append("id", applicationId);
    formData.append("adminNotes", reason);
    startTransition(async () => {
      const result = await declineAction(null, formData);
      emitToast(result.ok ? "Declined" : result.error, result.ok ? "success" : "error");
      if (result.ok) setDeclining(false);
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
          onClick={() => setDeclining((v) => !v)}
          disabled={pending}
          className="rounded border border-red-600/50 px-2 py-0.5 text-[11px] text-red-400 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Decline
        </button>
      </div>
      {declining && (
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
            onClick={decline}
            disabled={pending}
            className="self-start rounded border border-red-600/50 px-2 py-0.5 text-[11px] text-red-400 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Submitting…" : "Confirm decline"}
          </button>
        </div>
      )}
    </div>
  );
}
