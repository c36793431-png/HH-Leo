"use client";

import { useState, useTransition } from "react";
import { submitStrategyBuildAction } from "@/app/strategies/actions";
import {
  STRATEGY_CATEGORIES,
  STRATEGY_CONTACT_PREFERENCES,
  STRATEGY_FEED_REQUIREMENTS,
  STRATEGY_INSTRUMENTS,
} from "@/lib/strategy-submissions";
import { emitToast } from "@/lib/toast-bus";

const CATEGORY_LABELS: Record<(typeof STRATEGY_CATEGORIES)[number], string> = {
  arbitrage: "Arbitrage",
  momentum: "Momentum",
  grid: "Grid",
  scalping: "Scalping",
  custom: "Custom",
};

const FEED_LABELS: Record<(typeof STRATEGY_FEED_REQUIREMENTS)[number], string> = {
  london: "London",
  ny: "New York",
  cme: "CME",
  tokyo: "Tokyo",
};

const CONTACT_LABELS: Record<(typeof STRATEGY_CONTACT_PREFERENCES)[number], string> = {
  portal: "Portal",
  telegram: "Telegram",
  email: "Email",
};

export function AddYourStrategyForm() {
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
      const result = await submitStrategyBuildAction(null, formData);
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
        Add your strategy →
      </button>

      {open && (
        <div
          className="fp-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="fp-modal card" role="dialog" aria-modal="true" aria-label="Add your strategy">
            {succeeded ? (
              <>
                <h3 className="fp-cta-title">Strategy submitted</h3>
                <p className="fp-cta-copy">We&apos;ll review it and follow up.</p>
                <button type="button" className="btn ghost sm" onClick={close}>
                  Close
                </button>
              </>
            ) : (
              <form onSubmit={handleSubmit}>
                <h3 className="fp-cta-title">Add your strategy</h3>
                <p className="fp-cta-copy">Pitch a strategy you&apos;ve built and we&apos;ll review it.</p>

                <label className="fp-form-label" htmlFor="strategyName">
                  Name
                </label>
                <input
                  id="strategyName"
                  name="strategyName"
                  type="text"
                  required
                  disabled={isPending}
                  placeholder="e.g. Gold News Spike Fader"
                  className="fp-form-input"
                />

                <label className="fp-form-label" htmlFor="category">
                  Category
                </label>
                <select id="category" name="category" required disabled={isPending} className="fp-form-input">
                  <option value="">Select a category…</option>
                  {STRATEGY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>

                <label className="fp-form-label">Instruments</label>
                <div className="fp-form-checkbox-group">
                  {STRATEGY_INSTRUMENTS.map((i) => (
                    <label key={i} className="fp-form-checkbox">
                      <input type="checkbox" name="instruments" value={i} disabled={isPending} />
                      {i}
                    </label>
                  ))}
                </div>

                <label className="fp-form-label" htmlFor="feedRequirement">
                  Feed requirement (optional)
                </label>
                <select id="feedRequirement" name="feedRequirement" disabled={isPending} className="fp-form-input">
                  <option value="">No specific feed…</option>
                  {STRATEGY_FEED_REQUIREMENTS.map((f) => (
                    <option key={f} value={f}>
                      {FEED_LABELS[f]}
                    </option>
                  ))}
                </select>

                <label className="fp-form-label" htmlFor="description">
                  Description
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  required
                  disabled={isPending}
                  placeholder="How it trades, entries/exits, risk management…"
                  className="fp-form-input"
                />

                <label className="fp-form-label" htmlFor="contactPreference">
                  Contact preference
                </label>
                <select
                  id="contactPreference"
                  name="contactPreference"
                  required
                  disabled={isPending}
                  className="fp-form-input"
                >
                  <option value="">Select…</option>
                  {STRATEGY_CONTACT_PREFERENCES.map((c) => (
                    <option key={c} value={c}>
                      {CONTACT_LABELS[c]}
                    </option>
                  ))}
                </select>

                {error && <p className="fp-form-error">{error}</p>}

                <div className="fp-form-actions">
                  <button type="button" className="btn ghost sm" onClick={close} disabled={isPending}>
                    Cancel
                  </button>
                  <button type="submit" className="btn primary sm" disabled={isPending}>
                    {isPending ? "Submitting…" : "Submit strategy"}
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
