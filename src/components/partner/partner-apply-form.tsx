"use client";

import { useState, useTransition } from "react";
import { createPartnerApplicationAction } from "@/app/partner/apply/actions";
import { emitToast } from "@/lib/toast-bus";

/** Public partner-application form, mirrors black-waitlist-control.tsx's
 * useTransition/action pattern but as a plain page form (no modal chrome).
 *
 * Markup/classNames follow the .partner-v3 scoped design (see
 * app/partner/partner-landing.css, ported from mockups/horizon-referral-partner/
 * partner-landing-v3.html's .form-card / .form-success) -- submit logic and the
 * server action underneath are unchanged. Only intended to render inside a
 * .partner-v3-scoped ancestor (currently just app/partner/page.tsx). */
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
      <div className="pv-form-card pv-form-success">
        <div className="pv-fs-seal" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h3>Application received</h3>
        <p>Thanks — your application is under review. We&rsquo;ll be in touch on Telegram or email to get you set up.</p>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="pv-form-card">
      <div className="pv-frow">
        <div className="pv-field">
          <label htmlFor="name">
            Full name <span className="rq">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            disabled={isPending}
            className="ip"
            placeholder="Your name"
          />
        </div>

        <div className="pv-field">
          <label htmlFor="email">
            Email <span className="rq">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            disabled={isPending}
            className="ip"
            placeholder="you@email.com"
          />
        </div>
      </div>

      <div className="pv-field">
        <label htmlFor="telegram">Telegram handle</label>
        <div className="ipwrap">
          <span className="at">@</span>
          <input
            id="telegram"
            name="telegram"
            type="text"
            disabled={isPending}
            className="ip"
            placeholder="yourhandle"
          />
        </div>
      </div>

      <div className="pv-field">
        <label htmlFor="notes">About your audience</label>
        <textarea
          id="notes"
          name="notes"
          rows={5}
          disabled={isPending}
          className="ip"
          placeholder="Where's your community, how big is it, and what do they trade? A couple of lines is plenty."
        />
      </div>

      {error && <p className="pv-form-error">{error}</p>}

      <button type="submit" disabled={isPending} className="pv-btn amber full">
        {isPending ? "Submitting…" : "Submit application"} <span className="ar">→</span>
      </button>
      <div className="pv-form-foot">
        <span className="ic">✓</span> Goes straight to the Horizon partner team — nothing public.
      </div>
    </form>
  );
}
