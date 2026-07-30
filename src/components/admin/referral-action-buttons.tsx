"use client";

import { useActionState, useEffect } from "react";
import { markReferrerPaidAction, clawbackEarningAction } from "@/app/admin/referrals/actions";
import { emitToast } from "@/lib/toast-bus";

function useActionToast(state: { ok: boolean; error?: string } | null, successMessage: string) {
  useEffect(() => {
    if (state === null) return;
    if (state.ok) emitToast(successMessage, "success");
    else emitToast(state.error ?? "Action failed", "error");
  }, [state, successMessage]);
}

export function MarkPaidButton({ referrerUserId }: { referrerUserId: string }) {
  const [state, formAction, isPending] = useActionState(markReferrerPaidAction, null);
  useActionToast(state, "Payout recorded");

  return (
    <form action={formAction}>
      <input type="hidden" name="referrerUserId" value={referrerUserId} />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-emerald-500/90 px-3 py-1 text-xs font-medium text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Recording…" : "Mark paid"}
      </button>
    </form>
  );
}

export function ClawbackButton({ earningId }: { earningId: string }) {
  const [state, formAction, isPending] = useActionState(clawbackEarningAction, null);
  useActionToast(state, "Earning clawed back");

  return (
    <form action={formAction}>
      <input type="hidden" name="earningId" value={earningId} />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md border border-red-500/40 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "…" : "Clawback"}
      </button>
    </form>
  );
}
