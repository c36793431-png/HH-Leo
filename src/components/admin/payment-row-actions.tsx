"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { editPaymentAction, deletePaymentAction } from "@/app/admin/finance/actions";
import { emitToast } from "@/lib/toast-bus";
import type { PaymentRow } from "@/lib/payments";

const inputClass = "rounded border border-zinc-700 bg-black/40 px-1.5 py-0.5 text-xs text-zinc-200";

const CATEGORY_OPTIONS = [
  { value: "customer", label: "Customer" },
  { value: "partner", label: "Partner" },
  { value: "affiliate", label: "Affiliate" },
  { value: "feed_provider", label: "Feed provider" },
  { value: "infra", label: "Infra" },
  { value: "other", label: "Other" },
  { value: "referral_payout", label: "Referral payout" },
];

const DELETE_PHRASE = "CONFIRM";

/** Row-level edit/delete for /admin/finance — payments have no product-level undo, so edit
 * writes in place and delete requires typing CONFIRM rather than a plain window.confirm. */
export function PaymentRowActions({ payment }: { payment: PaymentRow }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const [editState, editFormAction, editPending] = useActionState(editPaymentAction, null);
  const [deleteState, deleteFormAction, deletePending] = useActionState(deletePaymentAction, null);
  const editFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (editState === null) return;
    if (editState.ok) {
      emitToast("Payment updated", "success");
      setEditing(false);
    } else {
      emitToast(editState.error, "error");
    }
  }, [editState]);

  useEffect(() => {
    if (deleteState === null) return;
    if (deleteState.ok) {
      emitToast("Payment deleted", "success");
      setDeleting(false);
    } else {
      emitToast(deleteState.error, "error");
    }
  }, [deleteState]);

  if (deleting) {
    return (
      <form action={deleteFormAction} className="flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="paymentId" value={payment.id} />
        <span className="text-[11px] text-red-400">Type {DELETE_PHRASE} to delete:</span>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className={`w-24 ${inputClass}`}
          autoFocus
        />
        <button
          type="submit"
          disabled={confirmText !== DELETE_PHRASE || deletePending}
          className="rounded border border-red-500 px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {deletePending ? "Deleting…" : "Delete"}
        </button>
        <button
          type="button"
          onClick={() => {
            setDeleting(false);
            setConfirmText("");
          }}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Cancel
        </button>
      </form>
    );
  }

  if (editing) {
    return (
      <form ref={editFormRef} action={editFormAction} className="flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="paymentId" value={payment.id} />
        <select name="direction" defaultValue={payment.direction} className={inputClass}>
          <option value="in">In</option>
          <option value="out">Out</option>
        </select>
        <input
          type="number"
          name="amountUsd"
          step="0.01"
          min="0.01"
          defaultValue={payment.amountUsd}
          className={`w-20 ${inputClass}`}
        />
        <input type="text" name="currency" defaultValue={payment.currency} maxLength={3} className={`w-12 ${inputClass}`} />
        <select name="category" defaultValue={payment.category} className={inputClass}>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="counterparty"
          defaultValue={payment.counterparty ?? ""}
          placeholder="counterparty"
          className={`w-28 ${inputClass}`}
        />
        <input type="text" name="memo" defaultValue={payment.memo ?? ""} placeholder="memo" className={`w-32 ${inputClass}`} />
        <button
          type="submit"
          disabled={editPending}
          className="rounded border border-cyan-500 px-2 py-0.5 text-xs text-cyan-300 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {editPending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-zinc-500 hover:text-zinc-300">
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={() => setDeleting(true)}
        className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300"
      >
        Delete
      </button>
    </div>
  );
}
