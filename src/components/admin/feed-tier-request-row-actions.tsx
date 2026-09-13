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

type Decision = "trial" | "paid";

const BTN_GREEN =
  "rounded border border-emerald-600/50 px-2 py-0.5 text-[11px] text-emerald-400 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_RED =
  "rounded border border-red-600/50 px-2 py-0.5 text-[11px] text-red-400 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50";
const INPUT =
  "w-48 rounded border border-zinc-700 bg-black/40 px-1.5 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 disabled:opacity-50";

/** Approve/reject pair for one /admin/feed-tier-requests row. Approve opens the decision
 * form (0086 phase 2, docs/specs/0086-phase2-code.md section 4(d); coxwell notice C5): radio
 * trial | paid; the end date and invoice ref are shown and required for paid only -- a trial
 * always ends 7 days from approval (S4), so it takes no date. Reject prompts for an optional
 * reason (forwarded to the client's decline DM). */
export function FeedTierRequestRowActions({ requestId, approveAction, rejectAction }: FeedTierRequestRowActionsProps) {
  const [pending, startTransition] = useTransition();
  const [approving, setApproving] = useState(false);
  const [decision, setDecision] = useState<Decision>("trial");
  const [endsAt, setEndsAt] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  function approve() {
    const formData = new FormData();
    formData.append("id", requestId);
    formData.append("decision", decision);
    if (decision === "paid") {
      formData.append("endsAt", endsAt);
      formData.append("invoiceRef", invoiceRef);
    }
    startTransition(async () => {
      const result = await approveAction(null, formData);
      emitToast(result.ok ? "Approved" : result.error, result.ok ? "success" : "error");
      if (result.ok) setApproving(false);
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

  const paidIncomplete = decision === "paid" && (!endsAt || !invoiceRef.trim());

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setApproving((v) => !v);
            setRejecting(false);
          }}
          disabled={pending}
          className={BTN_GREEN}
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => {
            setRejecting((v) => !v);
            setApproving(false);
          }}
          disabled={pending}
          className={BTN_RED}
        >
          Reject
        </button>
      </div>
      {approving && (
        <div className="flex flex-col gap-1 text-xs text-zinc-300">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={`decision-${requestId}`}
              value="trial"
              checked={decision === "trial"}
              onChange={() => setDecision("trial")}
              disabled={pending}
            />
            Trial <span className="text-zinc-500">(7 days from approval)</span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={`decision-${requestId}`}
              value="paid"
              checked={decision === "paid"}
              onChange={() => setDecision("paid")}
              disabled={pending}
            />
            Paid
          </label>
          {decision === "paid" && (
            <>
              <input
                type="date"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                disabled={pending}
                required
                aria-label="Access ends on"
                className={INPUT}
              />
              <input
                type="text"
                value={invoiceRef}
                onChange={(e) => setInvoiceRef(e.target.value)}
                disabled={pending}
                required
                placeholder="Invoice ref"
                aria-label="Invoice ref"
                className={INPUT}
              />
            </>
          )}
          <button type="button" onClick={approve} disabled={pending || paidIncomplete} className={`self-start ${BTN_GREEN}`}>
            {pending ? "Submitting…" : "Confirm approve"}
          </button>
        </div>
      )}
      {rejecting && (
        <div className="flex flex-col gap-1">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
            rows={2}
            placeholder="Reason (optional)…"
            className={INPUT}
          />
          <button type="button" onClick={reject} disabled={pending} className={`self-start ${BTN_RED}`}>
            {pending ? "Submitting…" : "Confirm reject"}
          </button>
        </div>
      )}
    </div>
  );
}
