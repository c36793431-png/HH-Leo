"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { submitFeedTierRequestAction } from "@/app/feeds/actions";
import { emitToast } from "@/lib/toast-bus";
import { SERVER_LOCATION_LABELS, type ServerLocation } from "@/lib/server-locations";

export interface TierRequestServerOption {
  licenseId: string;
  serverName: string | null;
  declaredIp: string | null;
  region: ServerLocation | "unspecified" | null;
  licenseKeyTail: string;
  /** False when this active license has no server_registrations row. Kept listable and
   * submittable (coxwell, leo-cross-region-server-picker-2026-09-04 refinement 3) -- it
   * lands in Fable's R6 "binding unconfirmed" list downstream. Do not filter or disable
   * on this. */
  registered: boolean;
}

function optionLabel(s: TierRequestServerOption): string {
  if (!s.registered) return `Not registered — License ****${s.licenseKeyTail}`;
  const location = SERVER_LOCATION_LABELS[s.region as ServerLocation] ?? "Unspecified";
  return `${s.serverName} — ${location} (${s.declaredIp})`;
}

interface TierRequestControlProps {
  region: string;
  tierKey: string;
  tierName: string;
  alreadyRequested: boolean;
  servers: TierRequestServerOption[];
  fallbackLicenseTail: string;
  variant?: "primary" | "amber";
}

/** Pre-selects a server per coxwell's ruling (leo-cross-region-server-picker-2026-09-04):
 * one server -> that one. Two-plus -> the one matching the tier's own region only if
 * exactly one does, otherwise no default so the client must choose. */
function defaultServerId(servers: TierRequestServerOption[], region: string): string | null {
  if (servers.length === 1) return servers[0].licenseId;
  if (servers.length >= 2) {
    const matches = servers.filter((s) => s.region === region);
    if (matches.length === 1) return matches[0].licenseId;
  }
  return null;
}

export function TierRequestControl({
  region,
  tierKey,
  tierName,
  alreadyRequested,
  servers,
  fallbackLicenseTail,
  variant = "primary",
}: TierRequestControlProps) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(alreadyRequested);
  const [isPending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(() => defaultServerId(servers, region));

  if (requested) {
    return (
      <span className="ftd-requested-pill">
        <span className="dot" /> Requested
      </span>
    );
  }

  const selected = servers.find((s) => s.licenseId === selectedId) ?? null;
  const canSubmit = !!selected;

  function handleOpen() {
    setSelectedId(defaultServerId(servers, region));
    setOpen(true);
  }

  function handleConfirm() {
    if (!selected) return;
    const formData = new FormData();
    formData.set("region", region);
    formData.set("tierKey", tierKey);
    formData.set("licenseId", selected.licenseId);
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
        onClick={handleOpen}
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

              {servers.length >= 2 ? (
                <div className="ftd-echo-row">
                  <span className="k">Server</span>
                  <select
                    className="v ftd-server-select"
                    value={selectedId ?? ""}
                    onChange={(e) => setSelectedId(e.target.value || null)}
                  >
                    <option value="" disabled>
                      Choose a server…
                    </option>
                    {servers.map((s) => (
                      <option key={s.licenseId} value={s.licenseId}>
                        {optionLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="ftd-echo-row">
                  <span className="k">Server</span>
                  <span className="v">{selected ? optionLabel(selected) : "no active license"}</span>
                </div>
              )}

              <div className="ftd-echo-row">
                <span className="k">IP</span>
                <span className="v">{selected?.declaredIp ?? "—"}</span>
              </div>
              <div className="ftd-echo-row">
                <span className="k">License</span>
                <span className="v">{selected?.licenseKeyTail ?? fallbackLicenseTail}</span>
              </div>
            </div>

            {servers.length === 0 ? (
              <p className="ftd-sla ftd-sla-warn">
                No active license on this account yet. <Link href="/account/servers">Register a server →</Link>
              </p>
            ) : (
              <p className="ftd-sla">
                Reviewed within 24h. Once approved, we&apos;ll DM you on Telegram — no need to check back here.
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
                disabled={isPending || !canSubmit}
                title={
                  !canSubmit
                    ? servers.length === 0
                      ? "No active license on this account"
                      : "Select a server before requesting access"
                    : undefined
                }
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
