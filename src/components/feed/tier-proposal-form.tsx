"use client";

import { useRef, useState, useTransition } from "react";
import { submitTierProposalAction } from "@/app/feed/dashboard/terms/actions";
import { MAX_ENDPOINTS_PER_PARENT, serializeEndpointRows } from "@/lib/provider-tier-endpoints";
import { emitToast } from "@/lib/toast-bus";

/** One endpoint row as the form holds it (section 1 row 1, docs/specs/0091-tier-endpoints-
 * design.md @ 6100dc0, :37; N rows per round, 2.2 :169-171). Strings only: the hidden input is
 * built by serializeEndpointRows, which is what keeps a port text on the wire (fable's delta-1
 * note N3). `notes` is provider-authored and rendered to Horizon's admins only (2.2 :172-177). */
interface EndpointDraft {
  protocol: string;
  endpointHost: string;
  endpointPort: string;
  compid: string;
  notes: string;
}

function emptyEndpoint(): EndpointDraft {
  return { protocol: "", endpointHost: "", endpointPort: "", compid: "", notes: "" };
}

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
  const [endpoints, setEndpoints] = useState<EndpointDraft[]>(() => [emptyEndpoint()]);

  function updateEndpoint(index: number, patch: Partial<EndpointDraft>) {
    setEndpoints((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addEndpoint() {
    setEndpoints((prev) => (prev.length >= MAX_ENDPOINTS_PER_PARENT ? prev : [...prev, emptyEndpoint()]));
  }

  function removeEndpoint(index: number) {
    setEndpoints((prev) => prev.filter((_, i) => i !== index));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await submitTierProposalAction(formData);
      emitToast(result.ok ? "Terms submitted for review" : result.error, result.ok ? "success" : "error");
      if (result.ok) {
        formRef.current?.reset();
        setEndpoints([emptyEndpoint()]);
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit}>
      <input type="hidden" name="applicationId" value={applicationId} />
      {/* The rows go to the action as one JSON list; the action's parser skips all-blank rows,
          numbers errors by the row as shown here (1-based, blanks included) and refuses a row
          that has a protocol or a SenderCompID but not both host and port. */}
      <input type="hidden" name="endpointsJson" value={serializeEndpointRows(endpoints)} />

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
          <label htmlFor="regions">Regions</label>
          <input id="regions" name="regions" defaultValue={regionsHint ?? ""} placeholder="LD4, NY4" />
        </div>
        <div className="field">
          <label htmlFor="coverage">Coverage</label>
          <input id="coverage" name="coverage" defaultValue={coverageHint ?? ""} placeholder="FX Majors, Metals, Indices" />
        </div>
      </div>

      {endpoints.map((row, i) => (
        <div key={i} style={{ marginBottom: 14 }}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label>
              Connection endpoint {i + 1} of {endpoints.length}
              {endpoints.length > 1 && (
                <>
                  {" "}
                  <button type="button" className="btn deny sm" onClick={() => removeEndpoint(i)}>
                    Remove
                  </button>
                </>
              )}
            </label>
          </div>
          <div className="grid g3" style={{ marginBottom: 8 }}>
            <div className="field">
              <label htmlFor={`endpointHost-${i}`}>Endpoint host</label>
              <input
                id={`endpointHost-${i}`}
                className="mono"
                value={row.endpointHost}
                onChange={(e) => updateEndpoint(i, { endpointHost: e.target.value })}
                placeholder="fix.blackarbitrage.com"
              />
            </div>
            <div className="field">
              <label htmlFor={`endpointPort-${i}`}>Endpoint port</label>
              <input
                id={`endpointPort-${i}`}
                className="mono"
                value={row.endpointPort}
                onChange={(e) => updateEndpoint(i, { endpointPort: e.target.value })}
                placeholder="9443"
              />
            </div>
            <div className="field">
              <label htmlFor={`protocol-${i}`}>Protocol</label>
              <input
                id={`protocol-${i}`}
                value={row.protocol}
                onChange={(e) => updateEndpoint(i, { protocol: e.target.value })}
                placeholder="FIX 4.4"
              />
            </div>
          </div>
          <div className="grid g2">
            <div className="field">
              <label htmlFor={`compid-${i}`}>SenderCompID</label>
              <input
                id={`compid-${i}`}
                className="mono"
                value={row.compid}
                onChange={(e) => updateEndpoint(i, { compid: e.target.value })}
                placeholder="BLACKFF01"
              />
            </div>
            <div className="field">
              <label htmlFor={`notes-${i}`}>Note for Horizon (which session this is)</label>
              <input
                id={`notes-${i}`}
                value={row.notes}
                onChange={(e) => updateEndpoint(i, { notes: e.target.value })}
                placeholder="e.g. BJF session, cTrader session"
              />
            </div>
          </div>
        </div>
      ))}

      <div className="field" style={{ marginBottom: 16 }}>
        {endpoints.length < MAX_ENDPOINTS_PER_PARENT && (
          <button type="button" className="btn ghost sm" onClick={addEndpoint} style={{ alignSelf: "flex-start" }}>
            + Add another endpoint
          </button>
        )}
        <span className="hint">
          An endpoint is a host and a port; protocol and SenderCompID describe that session, and the note is
          read by Horizon only. Up to {MAX_ENDPOINTS_PER_PARENT} per tier. On a tier&rsquo;s first round,
          endpoints, regions and coverage are optional — leave them blank if you&apos;d rather confirm them with
          Horizon directly. Once a tier is live, leaving an endpoint out, or leaving its protocol or SenderCompID
          blank, does <b>not</b> remove that detail: the round is <b>refused</b> and names the address, so
          re-enter every endpoint you want to keep. Removing a live endpoint is Horizon&rsquo;s to do — ask them.
        </span>
      </div>

      <button type="submit" className="btn primary sm" disabled={pending}>
        {pending ? "Submitting…" : "Submit for review"}
      </button>
    </form>
  );
}
