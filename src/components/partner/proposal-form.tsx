"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createProposalAction } from "@/app/partner/proposals/new/actions";
import { emitToast } from "@/lib/toast-bus";

const AVAILABLE_TIERS = ["ld-beta-56", "ld-gamma-19", "ld-delta-18", "ld-alpha-85"];

export function ProposalForm() {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(createProposalAction, null);

  const [price, setPrice] = useState(600);
  const [splitPct, setSplitPct] = useState(60);
  const [cadence, setCadence] = useState<"monthly" | "one_time">("monthly");
  const [tiers, setTiers] = useState<string[]>(["ld-beta-56", "ld-gamma-19", "ld-delta-18"]);
  const [clientEmail, setClientEmail] = useState("");

  useEffect(() => {
    if (state === null) return;
    if (state.ok) {
      emitToast("Proposal submitted", "success");
      router.push("/partner/dashboard");
    } else {
      emitToast(state.error ?? "Failed to submit proposal", "error");
    }
  }, [state, router]);

  const yourShare = useMemo(() => Math.round(price * (splitPct / 100)), [price, splitPct]);
  const horizonShare = price - yourShare;
  const annualised = cadence === "monthly" ? yourShare * 12 : yourShare;

  function toggleTier(t: string) {
    setTiers((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  return (
    <form action={formAction} className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-5">
        <section className="rounded-xl border border-[#f5b547]/35 bg-[#0a1019] p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded border border-[#f5b547]/30 bg-[#f5b547]/10 px-2 py-0.5 font-mono text-[11px] text-[#f5b547]">01</span>
            <b className="text-base">Client</b>
          </div>
          <p className="mb-3 text-xs text-zinc-500">Who is this deal for? Existing Horizon accounts link automatically.</p>
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-400">Client email</label>
          <input
            name="clientEmail"
            type="email"
            required
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            placeholder="name@email.com"
            className="w-full rounded-lg border border-zinc-700 bg-black/40 px-3 py-2.5 font-mono text-sm text-zinc-100 outline-none focus:border-[#f5b547]/60"
          />
        </section>

        <section className="rounded-xl border border-[#f5b547]/35 bg-[#0a1019] p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded border border-[#f5b547]/30 bg-[#f5b547]/10 px-2 py-0.5 font-mono text-[11px] text-[#f5b547]">02</span>
            <b className="text-base">Tiers in this deal</b>
          </div>
          <p className="mb-3 text-xs text-zinc-500">
            Pick the entitlements the client gets. Selected tiers ship as one bundle — a single price and one
            activation.
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {AVAILABLE_TIERS.map((t) => {
              const on = tiers.includes(t);
              return (
                <button
                  type="button"
                  key={t}
                  onClick={() => toggleTier(t)}
                  className={`rounded-lg border p-3 text-left ${
                    on ? "border-[#f5b547]/60 bg-[#f5b547]/10" : "border-zinc-800 bg-black/30"
                  }`}
                >
                  <div className="font-mono text-sm text-zinc-100">{t}</div>
                  <div className="mt-1 text-[10px] text-zinc-500">{on ? "in bundle" : "tap to add"}</div>
                </button>
              );
            })}
          </div>
          {tiers.map((t) => (
            <input key={t} type="hidden" name="tiers" value={t} />
          ))}
          <div className="mt-3 rounded-lg border border-violet-400/25 bg-violet-400/5 p-3 text-xs text-zinc-300">
            <b className="text-violet-300">Bundle:</b> selected tiers are sold as one line at one price and activate
            together. Horizon still grants, revokes and meters each tier individually under the hood.
          </div>
        </section>

        <section className="rounded-xl border border-[#f5b547]/35 bg-[#0a1019] p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded border border-[#f5b547]/30 bg-[#f5b547]/10 px-2 py-0.5 font-mono text-[11px] text-[#f5b547]">03</span>
            <b className="text-base">Price &amp; billing</b>
          </div>
          <p className="mb-3 text-xs text-zinc-500">
            Your suggested price for the bundle. Horizon confirms the final client price on approval.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-400">Suggested price</label>
              <input
                name="grossUsd"
                type="number"
                min="1"
                step="1"
                required
                value={price}
                onChange={(e) => setPrice(Number(e.target.value) || 0)}
                className="w-full rounded-lg border border-zinc-700 bg-black/40 px-3 py-2.5 font-mono text-sm text-zinc-100 outline-none focus:border-[#f5b547]/60"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-400">Billing cadence</label>
              <input type="hidden" name="cadence" value={cadence} />
              <div className="inline-flex rounded-lg border border-zinc-700 bg-black/40 p-1">
                <button
                  type="button"
                  onClick={() => setCadence("monthly")}
                  className={`rounded-md px-4 py-1.5 text-xs font-semibold ${
                    cadence === "monthly" ? "bg-violet-400/20 text-zinc-100" : "text-zinc-400"
                  }`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setCadence("one_time")}
                  className={`rounded-md px-4 py-1.5 text-xs font-semibold ${
                    cadence === "one_time" ? "bg-violet-400/20 text-zinc-100" : "text-zinc-400"
                  }`}
                >
                  One-time
                </button>
              </div>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-zinc-500">
            Recurring deals re-earn your share every cycle. One-time deals settle once.{" "}
            <b className="text-violet-300">This deal: {cadence === "monthly" ? "monthly" : "one-time"}.</b>
          </p>
        </section>

        <section className="rounded-xl border border-[#f5b547]/35 bg-[#0a1019] p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded border border-[#f5b547]/30 bg-[#f5b547]/10 px-2 py-0.5 font-mono text-[11px] text-[#f5b547]">04</span>
            <b className="text-base">Revenue split</b>
          </div>
          <p className="mb-3 text-xs text-zinc-500">
            Your share of gross. Horizon keeps the remainder for platform, license and support.
          </p>
          <input
            name="partnerPct"
            type="range"
            min={1}
            max={99}
            value={splitPct}
            onChange={(e) => setSplitPct(Number(e.target.value))}
            className="w-full accent-[#f5b547]"
          />
          <div className="mt-2 flex justify-between text-xs text-zinc-400">
            <span>
              You keep <b className="text-emerald-400">${yourShare}{cadence === "monthly" ? "/mo" : ""}</b> ({splitPct}%)
            </span>
            <span>
              Horizon <b className="text-zinc-200">${horizonShare}{cadence === "monthly" ? "/mo" : ""}</b> ({100 - splitPct}%)
            </span>
          </div>
        </section>

        <section className="rounded-xl border border-[#f5b547]/35 bg-[#0a1019] p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded border border-[#f5b547]/30 bg-[#f5b547]/10 px-2 py-0.5 font-mono text-[11px] text-[#f5b547]">05</span>
            <b className="text-base">
              Note to Horizon <span className="ml-1 text-xs font-normal text-zinc-500">· optional</span>
            </b>
          </div>
          <textarea
            name="note"
            rows={3}
            placeholder="Context on the client, anything Horizon should know before approving…"
            className="w-full rounded-lg border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-[#f5b547]/60"
          />
        </section>
      </div>

      <aside className="sticky top-6 h-fit rounded-xl border border-[#f5b547]/35 bg-[#0a1019] p-5">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live deal preview
        </div>
        <h3 className="mt-3 text-lg font-semibold">{clientEmail || "New bundle"}</h3>
        <div className="font-mono text-[11px] text-zinc-500">{tiers.length} tiers</div>
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-violet-400/40 bg-violet-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-violet-300">
          {cadence === "monthly" ? "Recurring · monthly" : "One-time"}
        </div>

        <div className="mt-4 space-y-3 border-t border-zinc-800 pt-3 text-sm">
          <div className="flex items-baseline justify-between border-b border-zinc-800 pb-2">
            <span className="text-zinc-400">Deal price</span>
            <span className="font-semibold">${price}{cadence === "monthly" ? "/mo" : ""}</span>
          </div>
          <div className="flex items-baseline justify-between border-b border-zinc-800 pb-2">
            <span className="text-zinc-400">Your share · {splitPct}%</span>
            <span className="text-xl font-bold text-emerald-400">${yourShare}{cadence === "monthly" ? "/mo" : ""}</span>
          </div>
          <div className="flex items-baseline justify-between border-b border-zinc-800 pb-2">
            <span className="text-zinc-400">Horizon · {100 - splitPct}%</span>
            <span className="font-semibold">${horizonShare}{cadence === "monthly" ? "/mo" : ""}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-zinc-400">{cadence === "monthly" ? "Annualised to you" : "Total to you"}</span>
            <span className="font-semibold">${annualised}{cadence === "monthly" ? "/yr" : ""}</span>
          </div>
        </div>

        <div className="mt-4 space-y-1">
          {tiers.map((t) => (
            <div key={t} className="flex items-center gap-2 font-mono text-xs text-zinc-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {t}
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-1 text-[11px] text-zinc-500">
          <div><span className="text-[#f5b547]">→</span> Submit for Horizon review</div>
          <div><span className="text-[#f5b547]">→</span> Approve &amp; confirm client price</div>
          <div><span className="text-[#f5b547]">→</span> First payment activates the bundle</div>
          <div><span className="text-[#f5b547]">→</span> Your share accrues every cycle</div>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="mt-4 w-full rounded-lg bg-gradient-to-r from-[#f5b547] to-[#d48b1e] px-4 py-2.5 text-sm font-semibold text-[#241704] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Submitting…" : "Submit proposal"}
        </button>
        <p className="mt-3 font-mono text-[10px] text-zinc-500">
          Nothing charges yet. The deal is proposed until Horizon approves and the client&apos;s first payment lands.
        </p>
      </aside>
    </form>
  );
}
