"use client";

import { startTransition, useActionState } from "react";
import { submitConsultantApplicationAction } from "@/app/consult/apply/actions";
import type { CONSULTANT_APPLICATION_LIMITS } from "@/lib/consultant-applications";

const INPUT = "mt-1 w-full rounded border border-zinc-700 bg-black/40 px-2 py-1.5 text-sm text-zinc-200";

/** The limits come from the page as a prop: importing the lib's value here would pull its server imports into the
 * client bundle. */
export function ConsultApplyForm({ limits: L }: { limits: typeof CONSULTANT_APPLICATION_LIMITS }) {
  const [state, formAction, isPending] = useActionState(submitConsultantApplicationAction, null);

  // Submitted by hand, not through <form action>: React resets an action form when it settles, which would clear
  // what the applicant typed on a refusal (e.g. the email already in review).
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => formAction(formData));
  }

  if (state?.ok) {
    return (
      <div id="apply-form" className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center">
        <p className="text-sm font-medium text-emerald-300">Application received.</p>
        <p className="mt-1 text-xs text-zinc-400">We review every application and reply by email.</p>
      </div>
    );
  }

  return (
    <form id="apply-form" onSubmit={handleSubmit} className="rounded-xl border border-cyan-500/10 bg-[#0b0e16]/60 p-5 sm:p-6">
      <h3 className="text-sm font-medium text-zinc-300">Apply</h3>
      <p className="mt-1.5 text-xs text-zinc-500">Tell us what you know and where you have done it.</p>

      {/* Honeypot (careers/application-form.tsx:133-137): hidden from real visitors, bots that fill every field trip it. */}
      <div style={{ position: "absolute", left: "-9999px" }} aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="consult-name" className="block text-xs text-zinc-500">Name</label>
          <input id="consult-name" name="name" type="text" required maxLength={L.name} disabled={isPending} className={INPUT} />
        </div>
        <div>
          <label htmlFor="consult-email" className="block text-xs text-zinc-500">Email</label>
          <input id="consult-email" name="email" type="email" required maxLength={L.email} disabled={isPending} className={INPUT} />
        </div>
        <div>
          <label htmlFor="consult-telegram" className="block text-xs text-zinc-500">Telegram (optional)</label>
          <input
            id="consult-telegram"
            name="telegram"
            type="text"
            minLength={L.telegramMin}
            maxLength={L.telegram}
            placeholder="@handle"
            disabled={isPending}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="consult-profile" className="block text-xs text-zinc-500">Profile link (optional)</label>
          <input
            id="consult-profile"
            name="profileUrl"
            type="url"
            maxLength={L.profileUrl}
            placeholder="https://"
            pattern="https?://.*"
            disabled={isPending}
            className={INPUT}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="consult-expertise" className="block text-xs text-zinc-500">Expertise</label>
          <textarea id="consult-expertise" name="expertise" rows={3} required maxLength={L.expertise} disabled={isPending} className={INPUT} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="consult-background" className="block text-xs text-zinc-500">Background (optional)</label>
          <textarea id="consult-background" name="background" rows={4} maxLength={L.background} disabled={isPending} className={INPUT} />
        </div>
      </div>

      {state && !state.ok && <p className="mt-3 text-xs text-red-400">{state.error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="mt-4 inline-flex items-center justify-center rounded-md bg-cyan-500/90 px-5 py-2.5 text-sm font-medium text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
