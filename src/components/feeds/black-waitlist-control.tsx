"use client";

import { useState, useTransition } from "react";
import { joinBlackWaitlistAction } from "@/app/feeds/actions";
import { emitToast } from "@/lib/toast-bus";

interface BlackWaitlistControlProps {
  region: string;
  tierKey: string;
  tierName: string;
  alreadyJoined: boolean;
}

export function BlackWaitlistControl({ region, tierKey, tierName, alreadyJoined }: BlackWaitlistControlProps) {
  const [open, setOpen] = useState(false);
  const [joined, setJoined] = useState(alreadyJoined);
  const [isPending, startTransition] = useTransition();

  if (joined) {
    return (
      <span className="ftd-requested-pill">
        <span className="dot" /> You&apos;re on the list
      </span>
    );
  }

  function handleConfirm() {
    const formData = new FormData();
    formData.set("region", region);
    formData.set("tierKey", tierKey);
    startTransition(async () => {
      const result = await joinBlackWaitlistAction(null, formData);
      if (result.ok) {
        setJoined(true);
        setOpen(false);
        emitToast("You're on the list — we'll be in touch.", "success");
      } else {
        emitToast(result.error, "error");
      }
    });
  }

  return (
    <>
      <button type="button" className="btn amber sm ftd-unlock" onClick={() => setOpen(true)}>
        Coming Soon
      </button>

      {open && (
        <div
          className="fp-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) setOpen(false);
          }}
        >
          <div className="fp-modal card" role="dialog" aria-modal="true" aria-label={`Join ${tierName} waitlist`}>
            <h3 className="fp-cta-title">Join the {tierName} tier waitlist</h3>
            <p className="fp-cta-copy">
              {tierName} is our top institutional-latency tier. We&apos;ll notify you when access opens up.
            </p>

            <div className="fp-form-actions">
              <button type="button" className="btn ghost sm" onClick={() => setOpen(false)} disabled={isPending}>
                Cancel
              </button>
              <button type="button" className="btn amber sm" onClick={handleConfirm} disabled={isPending}>
                {isPending ? "Joining…" : "Join waitlist"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
