"use client";

import { useActionState, useEffect, useRef } from "react";
import { createPartnerAction, createDealAction, confirmDealPaymentAction } from "@/app/admin/partners/actions";
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

export function AddPartnerForm() {
  const [state, formAction, isPending] = useActionState(createPartnerAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  useActionToast(state, "Partner added", () => formRef.current?.reset());

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col">
        <label className="text-[10px] uppercase tracking-wide text-zinc-500">Name</label>
        <input name="name" required className="rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200" />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] uppercase tracking-wide text-zinc-500">Handle</label>
        <input name="handle" className="rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200" />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] uppercase tracking-wide text-zinc-500">Email</label>
        <input name="email" type="email" className="rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200" />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-cyan-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Adding…" : "Add partner"}
      </button>
    </form>
  );
}

export function AddDealForm({ partners }: { partners: { id: string; name: string }[] }) {
  const [state, formAction, isPending] = useActionState(createDealAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  useActionToast(state, "Deal added", () => formRef.current?.reset());

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col">
        <label className="text-[10px] uppercase tracking-wide text-zinc-500">Partner</label>
        <select name="partnerId" required className="rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200">
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] uppercase tracking-wide text-zinc-500">Client email</label>
        <input name="clientEmail" type="email" required className="rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200" />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] uppercase tracking-wide text-zinc-500">Gross USD</label>
        <input name="grossUsd" type="number" step="0.01" min="0.01" required className="w-24 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200" />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] uppercase tracking-wide text-zinc-500">Partner %</label>
        <input name="partnerPct" type="number" step="1" min="1" max="99" defaultValue={60} required className="w-20 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200" />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-cyan-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Adding…" : "Add deal"}
      </button>
    </form>
  );
}

export function ConfirmDealPaymentForm({ dealId }: { dealId: string }) {
  const [state, formAction, isPending] = useActionState(confirmDealPaymentAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  useActionToast(state, "Payment recorded", () => formRef.current?.reset());

  return (
    <form ref={formRef} action={formAction} className="flex items-center gap-1.5">
      <input type="hidden" name="dealId" value={dealId} />
      <input
        name="amountUsd"
        type="number"
        step="0.01"
        min="0.01"
        required
        placeholder="Amount"
        className="w-20 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-xs text-zinc-200"
      />
      <input
        name="notes"
        placeholder="Notes"
        className="w-28 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-xs text-zinc-200"
      />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-emerald-500/90 px-2 py-1 text-xs font-medium text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "…" : "Confirm"}
      </button>
    </form>
  );
}
