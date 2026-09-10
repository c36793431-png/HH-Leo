"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

type Action = () => Promise<ActionResult>;

export interface BlackTrialCardProps {
  // "spent" means a trial that actually started and has since naturally expired -- a burn, per
  // marcus's 2026-09-10 ruling. A declined request is NOT spent (renders "none" instead, since
  // it never burned the client's one trial) -- see blackTrialCardProps in account/servers/page.tsx.
  status: "none" | "requested" | "active" | "spent" | "converted";
  expiresAt: string | null; // ISO, only meaningful when status === "active"
  spentAt: string | null; // ISO, only meaningful when status === "spent"
  // NOTE: the spent state deliberately has no CTA. It used to carry a "Request access" link to
  // /feeds/london/tiers, but that page's Black card is display-only (coxwell, 2026-09-10) and
  // its own CTA links straight back to /account/servers -- so the button performed a two-page
  // round trip and terminated nowhere. Nor could it have worked: requestBlackTrial gates on
  // getStartedBlackTrialForUser, which matches status in ('active','converted'), and a spent
  // row is an `active` row whose expires_at has passed (nothing restatuses a lapse) -- so a
  // spent client is refused with BlackTrialAlreadyUsedError before any insert. What a burned
  // client should actually be offered is a paid-access enquiry, which is a different object we
  // don't have; that's an open product question with coxwell (marcus, thread
  // leo-black-tiers-coming-soon-pass-2026-09-10). Until it's answered this states the fact and
  // stops, rather than promising a channel that doesn't exist.
  // The copy deliberately makes no claim about what the portal offers generally: Black IS
  // requestable here -- as a trial from the "none" state, and as paid access from the "active"
  // state's "Upgrade to keep" (requestBlackTrialConversion, which enquires to coxwell). Only
  // THIS reader can't, so the sentence stays scoped to the reader.
  endpoint: string | null;
  credentials: string | null;
  requestAction: Action;
  convertAction: Action;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function countdownLabel(expiresAtIso: string): string {
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  if (ms <= 0) return "Trial expired";
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    return hours < 1 ? "Ends in <1h" : `Ends in ${hours}h`;
  }
  return `${Math.ceil(ms / DAY_MS)} days left`;
}

export function BlackTrialCard({ status, expiresAt, spentAt, endpoint, credentials, requestAction, convertAction }: BlackTrialCardProps) {
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
        <p style={{ color: "var(--hz-ink-2)", fontSize: 13 }}>
          Trial ended{spentAt ? ` · ${new Date(spentAt).toLocaleDateString()}` : ""} · no re-trial.
          One trial per client, ever.
        </p>
      )}

      {localStatus === "converted" && (
        <p style={{ color: "var(--hz-ink-2)", fontSize: 13 }}>✅ Converted to a paid Black subscription.</p>
      )}
    </div>
  );
}
