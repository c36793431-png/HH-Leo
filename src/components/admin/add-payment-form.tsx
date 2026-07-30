"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addPaymentAction } from "@/app/admin/finance/actions";
import { emitToast } from "@/lib/toast-bus";

const inputClass = "rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200";

const CATEGORY_OPTIONS = [
  { value: "customer", label: "Customer" },
  { value: "partner", label: "Partner" },
  { value: "affiliate", label: "Affiliate" },
  { value: "feed_provider", label: "Feed provider" },
  { value: "infra", label: "Infra" },
  { value: "other", label: "Other" },
];

/** Local calendar date (not UTC) so the date input defaults to "today" as the admin sees it. */
function todayLocal(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function AddPaymentForm({ userEmails }: { userEmails: string[] }) {
  const [state, formAction, isPending] = useActionState(addPaymentAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [category, setCategory] = useState("customer");

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
    <form
      ref={formRef}
      action={formAction}
      onReset={() => {
        setDirection("in");
        setCategory("customer");
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <div>
        <label className="block text-xs text-zinc-500">Direction</label>
        <div className="mt-1 flex overflow-hidden rounded border border-zinc-700">
          {(["in", "out"] as const).map((d) => (
            <label
              key={d}
              className={`cursor-pointer px-3 py-1 text-sm ${
                direction === d
                  ? d === "in"
                    ? "bg-emerald-500/90 text-black"
                    : "bg-red-500/90 text-black"
                  : "bg-black/40 text-zinc-400"
              }`}
            >
              <input
                type="radio"
                name="direction"
                value={d}
                checked={direction === d}
                onChange={() => setDirection(d)}
                className="sr-only"
              />
              {d === "in" ? "In" : "Out"}
            </label>
          ))}
        </div>
      </div>
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
        <label className="block text-xs text-zinc-500">Category</label>
        <select
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={`mt-1 ${inputClass}`}
        >
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs text-zinc-500">Counterparty</label>
        <input
          type="text"
          name="counterparty"
          list={category === "customer" ? "payment-user-emails" : undefined}
          placeholder="email or name"
          className={`mt-1 w-48 ${inputClass}`}
        />
        {category === "customer" && (
          <datalist id="payment-user-emails">
            {userEmails.map((email) => (
              <option key={email} value={email} />
            ))}
          </datalist>
        )}
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
