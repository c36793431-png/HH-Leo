"use client";

import { useTransition } from "react";
import Link from "next/link";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

interface TermsQueueRowActionsProps {
  proposalId: string;
  confirmAction: Action;
}

/** Row's "Review ->" (opens the full card, not built yet) + inline "Confirm" -- the hot
 * path for the already-agreed case, confirming a round without opening it. */
export function TermsQueueRowActions({ proposalId, confirmAction }: TermsQueueRowActionsProps) {
  const [pending, startTransition] = useTransition();

  function confirm() {
    const formData = new FormData();
    formData.append("proposalId", proposalId);
    startTransition(async () => {
      const result = await confirmAction(null, formData);
      emitToast(result.ok ? "Confirmed" : result.error, result.ok ? "success" : "error");
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Link href={`/admin/providers/${proposalId}`} className="text-xs text-cyan-400 hover:text-cyan-300">
        Review →
      </Link>
      <button
        type="button"
        onClick={confirm}
        disabled={pending}
        className="rounded bg-emerald-500 px-2 py-0.5 text-[11px] text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Confirming…" : "Confirm"}
      </button>
    </div>
  );
}
