"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  approveDealAction,
  declineDealAction,
  recordOffPortalPaymentAction,
} from "@/app/admin/partner-approval-queue/actions";
import { emitToast } from "@/lib/toast-bus";

function useActionToast(state: { ok: boolean; error?: string } | null, successMessage: string, onSuccess?: () => void) {
  useEffect(() => {
    if (state === null) return;
    if (state.ok) {
      emitToast(successMessage, "success");
      onSuccess?.();
    } else {
      emitToast(state.error ?? "Action failed", "error");
    }
  }, [state, successMessage, onSuccess]);
}

export function ReviewActions({ dealId }: { dealId: string }) {
  const [approveState, approveAction, approvePending] = useActionState(approveDealAction, null);
  const [declineState, declineAction, declinePending] = useActionState(declineDealAction, null);
  useActionToast(approveState, "Deal approved & activated");
  useActionToast(declineState, "Deal declined");

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <form action={approveAction}>
        <input type="hidden" name="dealId" value={dealId} />
        <button
          type="submit"
          disabled={approvePending}
          className="rounded-md bg-gradient-to-r from-emerald-400 to-emerald-500 px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {approvePending ? "…" : "✓ Approve & activate"}
        </button>
      </form>
      <form action={declineAction}>
        <input type="hidden" name="dealId" value={dealId} />
        <button
          type="submit"
          disabled={declinePending}
          className="rounded-md border border-rose-400/40 px-4 py-2 text-sm font-semibold text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Decline
        </button>
      </form>
      <span className="ml-auto font-mono text-[11px] text-zinc-500">
        Approving grants the bundle and opens the payment ledger.
      </span>
    </div>
  );
}

export function RecordPaymentForm({ dealId }: { dealId: string }) {
  const [state, formAction, isPending] = useActionState(recordOffPortalPaymentAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  useActionToast(state, "Payment recorded", () => formRef.current?.reset());

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="dealId" value={dealId} />
      <input
        name="amountUsd"
        type="number"
        step="0.01"
        min="0.01"
        required
        placeholder="Amount received"
        className="w-32 rounded border border-zinc-700 bg-black/40 px-2 py-1.5 text-xs text-zinc-200"
      />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "…" : "＋ Record off-portal payment"}
      </button>
      <span className="text-[11px] text-zinc-500">
        Off-portal receipts just need the amount received — one click to confirm and it counts toward Received.
      </span>
    </form>
  );
}
