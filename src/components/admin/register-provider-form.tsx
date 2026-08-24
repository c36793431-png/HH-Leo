"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import type { ProviderApplicationRow } from "@/lib/provider-applications";
import { emitToast } from "@/lib/toast-bus";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

interface TierDraft {
  tierName: string;
  clientPrice: string;
  providerSplitPct: string;
  endpointHost: string;
  endpointPort: string;
  endpointVerified: boolean;
}

function emptyTier(defaults: { host: string; port: string }): TierDraft {
  return {
    tierName: "",
    clientPrice: "",
    providerSplitPct: "50",
    endpointHost: defaults.host,
    endpointPort: defaults.port,
    endpointVerified: false,
  };
}

const SECTION = "rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6";
const LABEL = "text-xs text-zinc-500";
const INPUT =
  "mt-1 w-full rounded border border-zinc-700 bg-black/40 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none";
const BADGE =
  "rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-300";

export function RegisterProviderForm({
  application,
  action,
}: {
  application: ProviderApplicationRow;
  action: Action;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(action, null);
  const [tiers, setTiers] = useState<TierDraft[]>(() => [
    emptyTier({ host: application.host ?? "", port: application.port ?? "" }),
  ]);

  useEffect(() => {
    if (state === null) return;
    if (state.ok) {
      emitToast("Provider registered — live", "success");
      router.push("/admin/provider-applications");
    } else {
      emitToast(state.error, "error");
    }
  }, [state, router]);

  function updateTier(index: number, patch: Partial<TierDraft>) {
    setTiers((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function addTier() {
    setTiers((prev) => [...prev, emptyTier({ host: application.host ?? "", port: application.port ?? "" })]);
  }

  function removeTier(index: number) {
    setTiers((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="applicationId" value={application.id} />
      <input type="hidden" name="tiersJson" value={JSON.stringify(tiers)} />

      {/* 1. Account */}
      <section className={SECTION}>
        <h2 className="text-sm font-medium text-cyan-400">Account</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>
            <span className={LABEL}>Provider name</span>
            <input className={INPUT} name="providerName" defaultValue={application.name} />
          </label>
          <label>
            <span className={LABEL}>Contact name</span>
            <input className={INPUT} name="contactName" defaultValue={application.contactName ?? ""} />
          </label>
          <label>
            <span className={LABEL}>Contact email</span>
            <input className={INPUT} name="contactEmail" defaultValue={application.email} />
          </label>
          <label>
            <span className={LABEL}>Country</span>
            <input className={INPUT} name="country" defaultValue={application.country ?? ""} />
          </label>
          <label>
            <span className={LABEL}>Timezone</span>
            <input className={INPUT} name="timezone" defaultValue={application.timezone ?? ""} />
          </label>
        </div>
      </section>

      {/* 2. Connection */}
      <section className={SECTION}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-cyan-400">Connection</h2>
          <span className={BADGE}>SUBMITTED · UNVERIFIED</span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Credentials aren&apos;t collected publicly — confirm the endpoint binding below at go-live (per tier).
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>
            <span className={LABEL}>Protocol</span>
            <input className={INPUT} name="protocol" defaultValue={application.protocol ?? ""} />
          </label>
          <label>
            <span className={LABEL}>Host</span>
            <input className={`${INPUT} font-mono`} name="host" defaultValue={application.host ?? ""} />
          </label>
          <label>
            <span className={LABEL}>Port</span>
            <input className={`${INPUT} font-mono`} name="port" defaultValue={application.port ?? ""} />
          </label>
          <label>
            <span className={LABEL}>Sender CompID</span>
            <input className={`${INPUT} font-mono`} name="senderCompId" defaultValue={application.compid ?? ""} />
          </label>
        </div>
      </section>

      {/* 3. Offering */}
      <section className={SECTION}>
        <h2 className="text-sm font-medium text-cyan-400">Offering</h2>
        <div className="mt-3 grid gap-3">
          <label>
            <span className={LABEL}>Offering description</span>
            <textarea className={INPUT} name="offeringDescription" defaultValue={application.tiersOffered ?? ""} rows={2} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className={LABEL}>Asset classes</span>
              <input className={INPUT} name="assetClasses" defaultValue={application.coverage ?? ""} />
            </label>
            <label>
              <span className={LABEL}>Regions</span>
              <input className={INPUT} name="regions" defaultValue={application.regions ?? ""} />
            </label>
          </div>
        </div>
      </section>

      {/* Admin-only: tiers */}
      <section className={SECTION}>
        <h2 className="text-sm font-medium text-cyan-400">Tiers to publish</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Admin-only — empty on pre-fill, required to submit. Split defaults to 50/50.
        </p>
        <div className="mt-3 flex flex-col gap-4">
          {tiers.map((tier, i) => (
            <div key={i} className="rounded-lg border border-zinc-700 bg-black/30 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-400">Tier {i + 1}</span>
                {tiers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTier(i)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label>
                  <span className={LABEL}>Tier name</span>
                  <input
                    className={INPUT}
                    value={tier.tierName}
                    onChange={(e) => updateTier(i, { tierName: e.target.value })}
                    placeholder="e.g. Alpha ultra-low-latency L2"
                  />
                </label>
                <label>
                  <span className={LABEL}>Client price (USD / mo)</span>
                  <input
                    className={INPUT}
                    type="number"
                    min="0"
                    step="0.01"
                    value={tier.clientPrice}
                    onChange={(e) => updateTier(i, { clientPrice: e.target.value })}
                    placeholder="499.00"
                  />
                </label>
                <label>
                  <span className={LABEL}>Provider split (%)</span>
                  <input
                    className={INPUT}
                    type="number"
                    min="0"
                    max="100"
                    value={tier.providerSplitPct}
                    onChange={(e) => updateTier(i, { providerSplitPct: e.target.value })}
                  />
                </label>
                <label className="flex items-center gap-2 self-end pb-1.5">
                  <input
                    type="checkbox"
                    checked={tier.endpointVerified}
                    onChange={(e) => updateTier(i, { endpointVerified: e.target.checked })}
                  />
                  <span className="text-xs text-zinc-400">Endpoint confirmed / go-live verified</span>
                </label>
                <label>
                  <span className={LABEL}>Endpoint host</span>
                  <input
                    className={`${INPUT} font-mono`}
                    value={tier.endpointHost}
                    onChange={(e) => updateTier(i, { endpointHost: e.target.value })}
                  />
                </label>
                <label>
                  <span className={LABEL}>Endpoint port</span>
                  <input
                    className={`${INPUT} font-mono`}
                    value={tier.endpointPort}
                    onChange={(e) => updateTier(i, { endpointPort: e.target.value })}
                  />
                </label>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addTier}
            className="self-start rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300"
          >
            + Add tier
          </button>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Publishing…" : "Publish & go live"}
        </button>
      </div>
    </form>
  );
}
