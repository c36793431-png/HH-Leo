"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

type Action = () => Promise<ActionResult>;

export interface BlackTrialCardProps {
  status: "none" | "requested" | "active" | "declined" | "converted";
  expiresAt: string | null; // ISO, only meaningful when status === "active"
  endpoint: string | null;
  credentials: string | null;
  requestAction: Action;
  convertAction: Action;
}

function daysLeft(expiresAtIso: string): number {
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export function BlackTrialCard({ status, expiresAt, endpoint, credentials, requestAction, convertAction }: BlackTrialCardProps) {
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
            Black is the top-ranked feed on our leaderboard. Request a trial against your
            registered server — coxwell whitelists your IP directly with the vendor, then your
            connection details land right here.
          </p>
          <button type="button" className="btn primary sm" disabled={pending} onClick={request}>
            {pending ? "Requesting…" : "Request Black trial"}
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
              {daysLeft(expiresAt) > 0 ? `${daysLeft(expiresAt)} days left` : "Trial expired"}
            </p>
          )}
          <button type="button" className="btn primary sm" disabled={pending || convertSent} onClick={convert}>
            {pending ? "Sending…" : convertSent ? "Upgrade request sent" : "Upgrade to keep →"}
          </button>
        </>
      )}

      {localStatus === "declined" && (
        <p style={{ color: "var(--hz-ink-2)", fontSize: 13 }}>Your Black trial request was declined.</p>
      )}

      {localStatus === "converted" && (
        <p style={{ color: "var(--hz-ink-2)", fontSize: 13 }}>✅ Converted to a paid Black subscription.</p>
      )}
    </div>
  );
}
