"use client";

import { useState, useTransition } from "react";
import { createPartnerApplicationAction } from "@/app/partner/apply/actions";
import { emitToast } from "@/lib/toast-bus";

/** Public partner-application form, mirrors black-waitlist-control.tsx's
 * useTransition/action pattern but as a plain page form (no modal chrome). */
export function PartnerApplyForm() {
  const [submitted, setSubmitted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createPartnerApplicationAction(null, formData);
      if (result.ok) {
        setSubmitted(true);
      } else {
        setError(result.error);
        emitToast(result.error, "error");
      }
    });
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-cyan-400/35 bg-cyan-950/30 px-6 py-8 text-center">
        <p className="text-sm text-zinc-100">
          Thanks — your application is under review, we&rsquo;ll be in touch.
        </p>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4 text-left">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-xs font-medium text-zinc-400">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          disabled={isPending}
          className="rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 disabled:opacity-50"
          placeholder="Your name"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-xs font-medium text-zinc-400">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          disabled={isPending}
          className="rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 disabled:opacity-50"
          placeholder="you@example.com"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="telegram" className="text-xs font-medium text-zinc-400">
          Telegram handle (optional)
        </label>
        <input
          id="telegram"
          name="telegram"
          type="text"
          disabled={isPending}
          className="rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 disabled:opacity-50"
          placeholder="@yourhandle"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-xs font-medium text-zinc-400">
          Why do you want to partner with us?
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={5}
          disabled={isPending}
          className="rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 disabled:opacity-50"
          placeholder="Tell us about your audience/community, expected referral volume, and why you'd be a good fit."
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="mt-2 rounded-lg bg-cyan-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
