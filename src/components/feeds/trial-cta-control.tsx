"use client";

import { useState, useTransition } from "react";
import { startFeedTierTrialAction, cancelFeedTierTrialAction } from "@/app/feeds/actions";
import { emitToast } from "@/lib/toast-bus";
import { humanizeTimeUntil, formatAbsoluteUtc } from "@/lib/format-time";
import { TRIAL_DURATION_DAYS, type TrialStatus } from "@/lib/feed-tier-trials";

export interface ExistingTrial {
  id: string;
  status: TrialStatus;
  endsAt: string;
}

interface TrialCtaControlProps {
  region: string;
  tierKey: string;
  tierName: string;
  existingTrial: ExistingTrial | null;
}

/** Trial CTA for the LD Alpha / LD Ultra tier-detail cards (marcus, horizon-portal-v2051-polish
 * trial add-on). Built from the dispatch's written spec -- Iris's `trial-option-tier-detail.html`
 * mock wasn't present anywhere in this session's filesystem, so this follows the same
 * "build now, correct later" pattern as the screens-2/3/4 wave: states isolated in one component
 * and one labeled CSS block for an easy pixel-diff pass once the real mock lands. */
export function TrialCtaControl({ region, tierKey, tierName, existingTrial }: TrialCtaControlProps) {
  const [open, setOpen] = useState(false);
  const [trial, setTrial] = useState(existingTrial);
  const [isPending, startTransition] = useTransition();

  if (trial?.status === "active") {
    const endsAt = new Date(trial.endsAt);
    return (
      <div className="ftd-trial-active">
        <span className="ftd-trial-pill">
          <span className="dot" /> Trial active · ends in {humanizeTimeUntil(endsAt)}
        </span>
        <button
          type="button"
          className="ftd-trial-cancel"
          disabled={isPending}
          onClick={() => {
            const formData = new FormData();
            formData.set("trialId", trial.id);
            startTransition(async () => {
              const result = await cancelFeedTierTrialAction(null, formData);
              if (result.ok) {
                setTrial({ ...trial, status: "cancelled" });
              } else {
                emitToast(result.error, "error");
              }
            });
          }}
        >
          {isPending ? "Cancelling…" : "Cancel trial"}
        </button>
      </div>
    );
  }

  if (trial?.status === "expired" || trial?.status === "cancelled") {
    return <span className="ftd-trial-ended">Trial ended · {formatAbsoluteUtc(new Date(trial.endsAt)).slice(0, 10)}</span>;
  }

  if (trial?.status === "converted") {
    return null;
  }

  function handleConfirm() {
    const formData = new FormData();
    formData.set("region", region);
    formData.set("tierKey", tierKey);
    startTransition(async () => {
      const result = await startFeedTierTrialAction(null, formData);
      if (result.ok) {
        setTrial({ id: result.trialId, status: "active", endsAt: result.endsAt });
        setOpen(false);
      } else {
        emitToast(result.error, "error");
      }
    });
  }

  return (
    <>
      <button type="button" className="btn ghost sm ftd-trial-start" onClick={() => setOpen(true)}>
        Start {TRIAL_DURATION_DAYS}-day free trial
      </button>

      {open && (
        <div
          className="fp-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) setOpen(false);
          }}
        >
          <div className="fp-modal card" role="dialog" aria-modal="true" aria-label={`Start ${tierName} trial`}>
            <h3 className="fp-cta-title">Start your {tierName} trial</h3>
            <p className="fp-cta-copy">
              {TRIAL_DURATION_DAYS} days of full {tierName} access, on us. One trial per tier — you won&apos;t be
              able to start another once this one ends.
            </p>

            <div className="fp-form-actions">
              <button type="button" className="btn ghost sm" onClick={() => setOpen(false)} disabled={isPending}>
                Cancel
              </button>
              <button type="button" className="btn primary sm" onClick={handleConfirm} disabled={isPending}>
                {isPending ? "Starting…" : "Start trial"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
