"use client";

import { useState, useTransition } from "react";
import { submitStrategyRequestAction } from "@/app/strategies/actions";
import { emitToast } from "@/lib/toast-bus";

export function StrategyRequestForm() {
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
      const result = await submitStrategyRequestAction(null, formData);
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
        Request a strategy →
      </button>

      {open && (
        <div
          className="fp-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="fp-modal card" role="dialog" aria-modal="true" aria-label="Request a strategy">
            {succeeded ? (
              <>
                <h3 className="fp-cta-title">Request received</h3>
                <p className="fp-cta-copy">We&apos;ll review it and follow up if we scope it.</p>
                <button type="button" className="btn ghost sm" onClick={close}>
                  Close
                </button>
              </>
            ) : (
              <form onSubmit={handleSubmit}>
                <h3 className="fp-cta-title">Request a strategy</h3>
                <p className="fp-cta-copy">
                  Don&apos;t worry about exact terminology — just tell us what you&apos;re after.
                </p>

                <label className="fp-form-label" htmlFor="ideaText">
                  What kind of strategy do you need?
                </label>
                <textarea
                  id="ideaText"
                  name="ideaText"
                  rows={3}
                  required
                  disabled={isPending}
                  placeholder="e.g. Something that trades news spikes on gold, mean-reversion on crypto perps…"
                  className="fp-form-input"
                />

                <label className="fp-form-label" htmlFor="assetText">
                  Asset focus (optional)
                </label>
                <input
                  id="assetText"
                  name="assetText"
                  type="text"
                  disabled={isPending}
                  placeholder="e.g. XAUUSD, ES futures, BTC perps…"
                  className="fp-form-input"
                />

                <label className="fp-form-label" htmlFor="timeframeText">
                  Session / timeframe (optional)
                </label>
                <input
                  id="timeframeText"
                  name="timeframeText"
                  type="text"
                  disabled={isPending}
                  placeholder="e.g. NY session, scalping, swing…"
                  className="fp-form-input"
                />

                <label className="fp-form-label" htmlFor="referencesText">
                  Similar strategies you&apos;ve seen (optional)
                </label>
                <textarea
                  id="referencesText"
                  name="referencesText"
                  rows={2}
                  disabled={isPending}
                  placeholder="Links, names, or a rough description of what you've seen elsewhere…"
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
