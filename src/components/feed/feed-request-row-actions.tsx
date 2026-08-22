"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/** Provider-styled approve/deny pair for one users-approvals queue row -- same shape as
 * admin's FeedTierRequestRowActions, styled with the provider panel's .btn classes instead
 * of admin's tailwind utility set. Approve is one click (spec: "one tap"); deny prompts for
 * an optional reason forwarded to the client's decline DM. */
export function FeedRequestRowActions({
  requestId,
  approveAction,
  rejectAction,
  approveLabel = "✓ Approve & activate",
}: {
  requestId: string;
  approveAction: Action;
  rejectAction: Action;
  approveLabel?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");

  function approve() {
    const formData = new FormData();
    formData.append("id", requestId);
    startTransition(async () => {
      const result = await approveAction(null, formData);
      emitToast(result.ok ? "Approved — client notified" : result.error, result.ok ? "success" : "error");
    });
  }

  function deny() {
    const formData = new FormData();
    formData.append("id", requestId);
    formData.append("reason", reason);
    startTransition(async () => {
      const result = await rejectAction(null, formData);
      emitToast(result.ok ? "Denied" : result.error, result.ok ? "success" : "error");
      if (result.ok) setDenying(false);
    });
  }

  if (denying) {
    return (
      <div className="qact" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={pending}
          rows={2}
          placeholder="Reason (optional)…"
          style={{
            background: "var(--pfp-bg-1)",
            border: "1px solid var(--pfp-line-soft)",
            borderRadius: 8,
            color: "var(--pfp-ink)",
            fontSize: 12,
            padding: 8,
          }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn ghost sm" onClick={() => setDenying(false)} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn deny sm" onClick={deny} disabled={pending}>
            {pending ? "Denying…" : "Confirm deny"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="qact">
      <button type="button" className="btn deny sm" onClick={() => setDenying(true)} disabled={pending}>
        Deny
      </button>
      <button type="button" className="btn approve sm" onClick={approve} disabled={pending}>
        {pending ? "Approving…" : approveLabel}
      </button>
    </div>
  );
}
