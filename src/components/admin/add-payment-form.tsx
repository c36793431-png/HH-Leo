"use client";

import { useActionState, useEffect, useRef } from "react";
import { addPaymentAction } from "@/app/admin/finance/actions";
import { emitToast } from "@/lib/toast-bus";

const inputClass = "rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200";

/** Local calendar date (not UTC) so the date input defaults to "today" as the admin sees it. */
function todayLocal(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function AddPaymentForm({ userEmails }: { userEmails: string[] }) {
  const [state, formAction, isPending] = useActionState(addPaymentAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state === null) return;
    if (state.ok) {
      emitToast("Payment recorded", "success");
      formRef.current?.reset();
    } else {
      emitToast(state.error, "error");
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-xs text-zinc-500">Date</label>
        <input type="date" name="receivedAt" defaultValue={todayLocal()} className={`mt-1 ${inputClass}`} />
      </div>
      <div>
        <label className="block text-xs text-zinc-500">Amount (USD)</label>
        <input
          type="number"
          name="amountUsd"
          step="0.01"
          min="0.01"
          required
          className={`mt-1 w-28 ${inputClass}`}
        />
      </div>
      <div>
        <label className="block text-xs text-zinc-500">Currency</label>
        <input type="text" name="currency" defaultValue="USD" maxLength={3} className={`mt-1 w-16 ${inputClass}`} />
      </div>
      <div>
        <label className="block text-xs text-zinc-500">Source</label>
        <select name="sourceType" defaultValue="customer" className={`mt-1 ${inputClass}`}>
          <option value="customer">Customer</option>
          <option value="partner">Partner</option>
          <option value="affiliate">Affiliate</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-zinc-500">Counterparty</label>
        <input
          type="text"
          name="counterparty"
          list="payment-user-emails"
          placeholder="email or name"
          className={`mt-1 w-48 ${inputClass}`}
        />
        <datalist id="payment-user-emails">
          {userEmails.map((email) => (
            <option key={email} value={email} />
          ))}
        </datalist>
      </div>
      <div className="min-w-[200px] flex-1">
        <label className="block text-xs text-zinc-500">Memo</label>
        <input type="text" name="memo" className={`mt-1 w-full ${inputClass}`} />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-cyan-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Add payment"}
      </button>
      {state && !state.ok && <p className="w-full text-xs text-red-400">{state.error}</p>}
    </form>
  );
}
