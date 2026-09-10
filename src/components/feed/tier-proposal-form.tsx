"use client";

import { useRef, useTransition } from "react";
import { submitTierProposalAction } from "@/app/feed/dashboard/terms/actions";
import { emitToast } from "@/lib/toast-bus";

export function TierProposalForm({
  applicationId,
  tierNameHint,
  regionsHint,
  coverageHint,
}: {
  applicationId: string;
  tierNameHint: string | null;
  regionsHint: string | null;
  coverageHint: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await submitTierProposalAction(formData);
      emitToast(result.ok ? "Terms submitted for review" : result.error, result.ok ? "success" : "error");
      if (result.ok) formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit}>
      <input type="hidden" name="applicationId" value={applicationId} />

      <div className="grid g3" style={{ marginBottom: 14 }}>
        <div className="field">
          <label htmlFor="tierName">Tier name</label>
          <input id="tierName" name="tierName" required defaultValue={tierNameHint ?? ""} placeholder="e.g. LMAX 1000tps" />
        </div>
        <div className="field">
          <label htmlFor="clientPrice">Client price (USD / mo)</label>
          <input id="clientPrice" name="clientPrice" type="number" min="0" step="0.01" required placeholder="500" />
        </div>
        <div className="field">
          <label htmlFor="providerSplitPct">Your split (%)</label>
          <input id="providerSplitPct" name="providerSplitPct" type="number" min="0" max="100" required placeholder="50" />
        </div>
      </div>

      <div className="grid g3" style={{ marginBottom: 14 }}>
        <div className="field">
          <label htmlFor="trialLengthDays">Trial length (days)</label>
          <input id="trialLengthDays" name="trialLengthDays" type="number" min="0" defaultValue={14} />
        </div>
        <div className="field">
          <label htmlFor="protocol">Protocol</label>
          <input id="protocol" name="protocol" placeholder="FIX 4.4" />
        </div>
        <div className="field">
          <label htmlFor="compid">SenderCompID</label>
          <input id="compid" name="compid" className="mono" placeholder="BLACKFF01" />
        </div>
      </div>

      <div className="grid g3" style={{ marginBottom: 14 }}>
        <div className="field">
          <label htmlFor="endpointHost">Endpoint host</label>
          <input id="endpointHost" name="endpointHost" className="mono" placeholder="fix.blackarbitrage.com" />
        </div>
        <div className="field">
          <label htmlFor="endpointPort">Endpoint port</label>
          <input id="endpointPort" name="endpointPort" className="mono" placeholder="9443" />
        </div>
        <div className="field">
          <label htmlFor="regions">Regions</label>
          <input id="regions" name="regions" defaultValue={regionsHint ?? ""} placeholder="LD4, NY4" />
        </div>
      </div>

      <div className="field" style={{ marginBottom: 16 }}>
        <label htmlFor="coverage">Coverage</label>
        <input id="coverage" name="coverage" defaultValue={coverageHint ?? ""} placeholder="FX Majors, Metals, Indices" />
        <span className="hint">Comma-separated. Endpoint, protocol, and coverage are optional — leave blank if you&apos;d rather confirm them with Horizon directly.</span>
      </div>

      <button type="submit" className="btn primary sm" disabled={pending}>
        {pending ? "Submitting…" : "Submit for review"}
      </button>
    </form>
  );
}
