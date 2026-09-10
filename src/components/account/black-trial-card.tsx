"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

type Action = () => Promise<ActionResult>;

export interface BlackTrialCardProps {
  // "spent" covers every exhausted trial uniformly (declined, naturally expired, or already
  // used on a different license) -- row existence is permanent, so there's one dead-end state,
  // not three. See getBlackTrialForUser: this is derived server-side from row existence, never
  // from a date comparison.
  status: "none" | "requested" | "active" | "spent" | "converted";
  expiresAt: string | null; // ISO, only meaningful when status === "active"
  spentAt: string | null; // ISO, only meaningful when status === "spent"
  requestAccessHref: string; // spent-state CTA -- the existing feed-access request flow, never a checkout
  endpoint: string | null;
  credentials: string | null;
  requestAction: Action;
  convertAction: Action;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function countdownLabel(expiresAtIso: string): string {
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  if (ms <= 0) return "Trial expired";
  if (ms < DAY_MS) return "Ends today";
  return `${Math.ceil(ms / DAY_MS)} days left`;
}

export function BlackTrialCard({ status, expiresAt, spentAt, requestAccessHref, endpoint, credentials, requestAction, convertAction }: BlackTrialCardProps) {
  const [pending, startTransition] = useTransition();
  const [localStatus, setLocalStatus] = useState(status);
  const [convertSent, setConvertSent] = useState(false);

  function request() {
    startTransition(async () => {
      const result = await requestAction();
      if (!result.ok) {
        emitToast(result.error, "error");
        return;
      }
      setLocalStatus("requested");
      emitToast("Black trial requested — coxwell will whitelist your server.", "success");
    });
  }

  function convert() {
    startTransition(async () => {
      const result = await convertAction();
      if (!result.ok) {
        emitToast(result.error, "error");
        return;
      }
      setConvertSent(true);
      emitToast("Upgrade request sent.", "success");
    });
  }

  return (
    <div className="card full">
      <div className="chead">
        <span className="ic">⚫️</span>
        <h3>Black trial</h3>
      </div>

      {localStatus === "none" && (
        <>
          <p style={{ color: "var(--hz-ink-2)", fontSize: 13, marginBottom: 16 }}>
            Black is the top-ranked feed on our leaderboard. One trial per client — first time
            only. Request a trial against your registered server — coxwell whitelists your IP
            directly with the vendor, then your connection details land right here.
          </p>
          <button type="button" className="btn primary sm" disabled={pending} onClick={request}>
            {pending ? "Requesting…" : "Start 3-day trial"}
          </button>
        </>
      )}

      {localStatus === "requested" && (
        <p style={{ color: "var(--hz-ink-2)", fontSize: 13 }}>
          ⏳ Pending — your Black trial request is with the desk for whitelisting.
        </p>
      )}

      {localStatus === "active" && (
        <>
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            <div>
              <b>Endpoint:</b> <code>{endpoint}</code>
            </div>
            <div>
              <b>Credentials:</b> <code>{credentials}</code>
            </div>
          </div>
          {expiresAt && (
            <p style={{ color: "var(--hz-amber, #f0a94b)", fontSize: 13, marginBottom: 12 }}>
              {countdownLabel(expiresAt)}
            </p>
          )}
          <button type="button" className="btn primary sm" disabled={pending || convertSent} onClick={convert}>
            {pending ? "Sending…" : convertSent ? "Upgrade request sent" : "Upgrade to keep →"}
          </button>
        </>
      )}

      {localStatus === "spent" && (
        <>
          <p style={{ color: "var(--hz-ink-2)", fontSize: 13, marginBottom: 12 }}>
            Trial ended{spentAt ? ` · ${new Date(spentAt).toLocaleDateString()}` : ""} · no re-trial.
            One trial per client, ever. Since Black pricing is negotiated directly, request access
            and coxwell will reach out to arrange it.
          </p>
          <a className="btn primary sm" href={requestAccessHref}>
            Request access
          </a>
        </>
      )}

      {localStatus === "converted" && (
        <p style={{ color: "var(--hz-ink-2)", fontSize: 13 }}>✅ Converted to a paid Black subscription.</p>
      )}
    </div>
  );
}
