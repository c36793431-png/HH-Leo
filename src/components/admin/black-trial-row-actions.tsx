"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

interface BlackTrialRowActionsProps {
  requestId: string;
  approveAction: Action;
  declineAction: Action;
}

const inputClass = "rounded border border-zinc-700 bg-black/40 px-2 py-1 text-xs text-zinc-200";

/** Approve prompts for the BFF-issued endpoint/credentials + trial length (coxwell
 * whitelists manually at BFF first, then pastes what they get back here) -- decline
 * prompts for an optional reason forwarded to the client's decline DM. */
export function BlackTrialRowActions({ requestId, approveAction, declineAction }: BlackTrialRowActionsProps) {
  const [pending, startTransition] = useTransition();
  const [approving, setApproving] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [credentials, setCredentials] = useState("");
  const [trialDays, setTrialDays] = useState("7");
  const [reason, setReason] = useState("");

  function approve() {
    const formData = new FormData();
    formData.append("id", requestId);
    formData.append("endpoint", endpoint);
    formData.append("credentials", credentials);
    formData.append("trialDays", trialDays);
    startTransition(async () => {
      const result = await approveAction(null, formData);
      emitToast(result.ok ? "Activated" : result.error, result.ok ? "success" : "error");
      if (result.ok) setApproving(false);
    });
  }

  function decline() {
    const formData = new FormData();
    formData.append("id", requestId);
    formData.append("reason", reason);
    startTransition(async () => {
      const result = await declineAction(null, formData);
      emitToast(result.ok ? "Declined" : result.error, result.ok ? "success" : "error");
      if (result.ok) setDeclining(false);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setApproving((v) => !v)}
          disabled={pending}
          className="rounded border border-emerald-600/50 px-2 py-0.5 text-[11px] text-emerald-400 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Activate
        </button>
        <button
          type="button"
          onClick={() => setDeclining((v) => !v)}
          disabled={pending}
          className="rounded border border-red-600/50 px-2 py-0.5 text-[11px] text-red-400 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Decline
        </button>
      </div>
      {approving && (
        <div className="flex w-56 flex-col gap-1">
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            disabled={pending}
            placeholder="Endpoint (from BFF whitelist)"
            className={inputClass}
          />
          <textarea
            value={credentials}
            onChange={(e) => setCredentials(e.target.value)}
            disabled={pending}
            rows={2}
            placeholder="Credentials"
            className={inputClass}
          />
          <input
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
            disabled={pending}
            type="number"
            min="1"
            placeholder="Trial days"
            className={`${inputClass} w-20`}
          />
          <button
            type="button"
            onClick={approve}
            disabled={pending}
            className="self-start rounded border border-emerald-600/50 px-2 py-0.5 text-[11px] text-emerald-400 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Activating…" : "Confirm activate"}
          </button>
        </div>
      )}
      {declining && (
        <div className="flex w-48 flex-col gap-1">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
            rows={2}
            placeholder="Reason (optional)…"
            className={inputClass}
          />
          <button
            type="button"
            onClick={decline}
            disabled={pending}
            className="self-start rounded border border-red-600/50 px-2 py-0.5 text-[11px] text-red-400 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Submitting…" : "Confirm decline"}
          </button>
        </div>
      )}
    </div>
  );
}
