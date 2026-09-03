"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { submitFeedTierRequestAction } from "@/app/feeds/actions";
import { emitToast } from "@/lib/toast-bus";

interface TierRequestControlProps {
  region: string;
  tierKey: string;
  tierName: string;
  alreadyRequested: boolean;
  serverName: string | null;
  serverIp: string | null;
  licenseTail: string;
  variant?: "primary" | "amber";
}

export function TierRequestControl({
  region,
  tierKey,
  tierName,
  alreadyRequested,
  serverName,
  serverIp,
  licenseTail,
  variant = "primary",
}: TierRequestControlProps) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(alreadyRequested);
  const [isPending, startTransition] = useTransition();

  if (requested) {
    return (
      <span className="ftd-requested-pill">
        <span className="dot" /> Requested
      </span>
    );
  }

  function handleConfirm() {
    const formData = new FormData();
    formData.set("region", region);
    formData.set("tierKey", tierKey);
    startTransition(async () => {
      const result = await submitFeedTierRequestAction(null, formData);
      if (result.ok) {
        setRequested(true);
        setOpen(false);
      } else {
        emitToast(result.error, "error");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className={`btn ${variant === "amber" ? "amber" : "primary"} sm ftd-unlock`}
        onClick={() => setOpen(true)}
      >
        Request access
      </button>

      {open && (
        <div
          className="fp-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) setOpen(false);
          }}
        >
          <div className="fp-modal card" role="dialog" aria-modal="true" aria-label={`Request ${tierName} access`}>
            <h3 className="fp-cta-title">Request {tierName} access</h3>
            <p className="fp-cta-copy">Confirm the details below — we&apos;ll route this to the team for review.</p>

            <div className="ftd-echo">
              <div className="ftd-echo-row">
                <span className="k">Tier</span>
                <span className="v">{tierName}</span>
              </div>
              <div className="ftd-echo-row">
                <span className="k">Server</span>
                <span className="v">{serverName ?? "not registered"}</span>
              </div>
              <div className="ftd-echo-row">
                <span className="k">IP</span>
                <span className="v">{serverIp ?? "—"}</span>
              </div>
              <div className="ftd-echo-row">
                <span className="k">License</span>
                <span className="v">{licenseTail}</span>
              </div>
            </div>

            {serverName ? (
              <p className="ftd-sla">
                Reviewed within 24h. Once approved, we&apos;ll DM you on Telegram — no need to check back here.
              </p>
            ) : (
              <p className="ftd-sla ftd-sla-warn">
                No server registered in this region yet. <Link href="/account/servers">Register one first →</Link>
              </p>
            )}

            <div className="fp-form-actions">
              <button type="button" className="btn ghost sm" onClick={() => setOpen(false)} disabled={isPending}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${variant === "amber" ? "amber" : "primary"} sm`}
                onClick={handleConfirm}
                disabled={isPending || !serverName}
                title={!serverName ? "Register a server in this region before requesting access" : undefined}
              >
                {isPending ? "Submitting…" : "Confirm request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
