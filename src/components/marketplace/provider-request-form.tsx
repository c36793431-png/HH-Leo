"use client";

import { startTransition, useActionState } from "react";
import { sendProviderRequestAction } from "@/app/marketplace/services/[slug]/actions";

const INPUT = "mt-1 w-full rounded border border-zinc-700 bg-black/40 px-2 py-1.5 text-sm text-zinc-200";

/** "Request this provider" (consult S4). Horizon passes it on (no provider inbox in v1), so the form says so. The
 * Telegram field shows only when the account has none on file (0105's rule). Limits come from the page as props. */
export function ProviderRequestForm({ slug, askTelegram, limits: L }: { slug: string; askTelegram: boolean; limits: { message: number; telegramMin: number; telegram: number } }) {
  const [state, formAction, isPending] = useActionState(sendProviderRequestAction, null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => formAction(formData));
  }

  if (state?.ok) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-sm">
        <p className="font-medium text-emerald-300">Request sent.</p>
        <p className="mt-1 text-zinc-400">Horizon passes it to the provider and will be in touch with you.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-zinc-800 bg-black/30 p-5">
      <input type="hidden" name="slug" value={slug} />
      <label htmlFor="req-message" className="block text-xs text-zinc-500">What do you need help with?</label>
      <textarea id="req-message" name="message" rows={4} required maxLength={L.message} disabled={isPending} className={INPUT} />
      <p className="mt-1 text-xs text-zinc-500">No prices or contact details: Horizon passes your request on.</p>
      {askTelegram && (
        <div className="mt-3">
          <label htmlFor="req-telegram" className="block text-xs text-zinc-500">Your Telegram (optional, so we can reach you)</label>
          <input id="req-telegram" name="telegram" minLength={L.telegramMin} maxLength={L.telegram} placeholder="@handle" disabled={isPending} className={INPUT} />
        </div>
      )}
      {state && !state.ok && <p className="mt-3 text-xs text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="mt-4 inline-flex items-center justify-center rounded-md bg-cyan-500/90 px-5 py-2.5 text-sm font-medium text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}
