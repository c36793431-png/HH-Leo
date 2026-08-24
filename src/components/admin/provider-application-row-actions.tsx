"use client";

import { useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

interface ProviderApplicationRowActionsProps {
  applicationId: string;
  approveAction: Action;
  declineAction: Action;
}

/** Approve/reject pair for one /admin/provider-applications row. MVP scope: no reason field on
 * reject (unlike PartnerApplicationRowActions) -- just a window.confirm guard, per the
 * admin-provider-applications-2026-08-23 spec. */
export function ProviderApplicationRowActions({
  applicationId,
  approveAction,
  declineAction,
}: ProviderApplicationRowActionsProps) {
  const [pending, startTransition] = useTransition();

  function approve() {
    const formData = new FormData();
    formData.append("id", applicationId);
    startTransition(async () => {
      const result = await approveAction(null, formData);
      emitToast(result.ok ? "Approved" : result.error, result.ok ? "success" : "error");
    });
  }

  function reject() {
    if (!window.confirm("Reject this provider application?")) return;
    const formData = new FormData();
    formData.append("id", applicationId);
    startTransition(async () => {
      const result = await declineAction(null, formData);
      emitToast(result.ok ? "Rejected" : result.error, result.ok ? "success" : "error");
    });
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={approve}
        disabled={pending}
        className="rounded border border-teal-500/50 px-2 py-0.5 text-[11px] text-teal-400 hover:border-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Approve
      </button>
      <button
        type="button"
        onClick={reject}
        disabled={pending}
        className="rounded border border-red-600/50 px-2 py-0.5 text-[11px] text-red-400 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}
