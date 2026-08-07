"use client";

import { useState, useTransition } from "react";
import { submitFeedRequestAction } from "@/app/feeds/actions";
import { emitToast } from "@/lib/toast-bus";

export function FeedRequestForm() {
  const [open, setOpen] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setSucceeded(false);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await submitFeedRequestAction(null, formData);
      if (result.ok) {
        setSucceeded(true);
      } else {
        setError(result.error);
        emitToast(result.error, "error");
      }
    });
  }

  return (
    <>
      <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>
        Request a feed →
      </button>

      {open && (
        <div
          className="fp-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="fp-modal card" role="dialog" aria-modal="true" aria-label="Request a feed">
            {succeeded ? (
              <>
                <h3 className="fp-cta-title">Request received</h3>
                <p className="fp-cta-copy">We&apos;ll review it and follow up if we ship it.</p>
                <button type="button" className="btn ghost sm" onClick={close}>
                  Close
                </button>
              </>
            ) : (
              <form onSubmit={handleSubmit}>
                <h3 className="fp-cta-title">Request a feed</h3>
                <p className="fp-cta-copy">
                  Don&apos;t worry about exact terminology — just tell us what you need.
                </p>

                <label className="fp-form-label" htmlFor="venueText">
                  Feed / venue you want
                </label>
                <input
                  id="venueText"
                  name="venueText"
                  type="text"
                  required
                  disabled={isPending}
                  placeholder="e.g. Eurex, Singapore SGX, a specific FX ECN…"
                  className="fp-form-input"
                />

                <label className="fp-form-label" htmlFor="useCaseText">
                  What are you trying to trade, hedge, or arb?
                </label>
                <textarea
                  id="useCaseText"
                  name="useCaseText"
                  rows={3}
                  required
                  disabled={isPending}
                  className="fp-form-input"
                />

                <label className="fp-form-label" htmlFor="preferredLocation">
                  Preferred setup location (optional)
                </label>
                <input
                  id="preferredLocation"
                  name="preferredLocation"
                  type="text"
                  disabled={isPending}
                  placeholder="e.g. Equinix SG1, near-colo, doesn't matter…"
                  className="fp-form-input"
                />

                {error && <p className="fp-form-error">{error}</p>}

                <div className="fp-form-actions">
                  <button type="button" className="btn ghost sm" onClick={close} disabled={isPending}>
                    Cancel
                  </button>
                  <button type="submit" className="btn primary sm" disabled={isPending}>
                    {isPending ? "Submitting…" : "Submit request"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
