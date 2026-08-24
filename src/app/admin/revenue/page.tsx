import Link from "next/link";
import { getProviderMarketplaceSummary, listAllLiveTiers } from "@/lib/provider-tiers";

// Revenue-split tab (Iris's spec §9, bus thread feed-admin-dashboard-build-2026-08-24).
// Headline = Horizon-retained (coxwell hasn't confirmed gross-vs-retained yet) -- both
// figures are already computed side-by-side in getProviderMarketplaceSummary(), so swapping
// which one headlines is a one-line change here, not a lib change. Per-tier table is the
// auditability the footnote promises: every dollar in the rollup traces to a live tier row.
function fmtUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function AdminRevenuePage() {
  const [summary, tiers] = await Promise.all([
    getProviderMarketplaceSummary(),
    listAllLiveTiers(),
  ]);
  const empty = tiers.length === 0;

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Revenue · Run-rate
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Revenue split</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Contracted run-rate across live feed-provider tiers — price × split, not reconciled
          payments.
        </p>
      </header>

      {empty ? (
        <div className="mb-6 rounded-lg border border-zinc-700/50 bg-zinc-900/40 px-4 py-2.5 text-sm text-zinc-400">
          No live tiers yet — run-rate has nothing to compute until a provider tier is
          confirmed.
        </div>
      ) : (
        <>
          <section className="mb-6 rounded-xl border border-emerald-400/35 bg-emerald-950/20 p-6">
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              Horizon-retained run-rate / mo
            </div>
            <div className="mt-1 text-3xl font-semibold text-emerald-300">
              {fmtUsd(summary.retainedRunRateCents)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
              <span>
                Gross <span className="text-zinc-300">{fmtUsd(summary.grossRunRateCents)}</span>
              </span>
              <span>
                Provider payout{" "}
                <span className="text-zinc-300">
                  {fmtUsd(summary.grossRunRateCents - summary.retainedRunRateCents)}
                </span>
              </span>
            </div>
          </section>

          <section className="mb-6 rounded-xl border border-zinc-700/50 bg-zinc-900/40 p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="pb-2 pr-4">Provider</th>
                    <th className="pb-2 pr-4">Tier</th>
                    <th className="pb-2 pr-4">Price</th>
                    <th className="pb-2 pr-4">Split</th>
                    <th className="pb-2 pr-4">Provider payout</th>
                    <th className="pb-2">Retained</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {tiers.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2 pr-4 text-zinc-200">{t.providerName}</td>
                      <td className="py-2 pr-4 text-zinc-300">{t.tierName}</td>
                      <td className="py-2 pr-4 text-zinc-400">{fmtUsd(t.clientPriceCents)}</td>
                      <td className="py-2 pr-4 text-zinc-400">{t.providerSplitPct}%</td>
                      <td className="py-2 pr-4 text-zinc-400">{fmtUsd(t.providerPayoutCents)}</td>
                      <td className="py-2 text-emerald-300">{fmtUsd(t.retainedCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <p className="text-xs text-zinc-500">
        Contracted run-rate — price × split across live tiers. Not reconciled against payments
        received. Includes live tiers only; draft, unpublished, or trial-only tiers are
        excluded.
      </p>

      <div className="mt-6 text-sm">
        <Link href="/admin" className="text-cyan-400 hover:underline">
          ← Back to overview
        </Link>
      </div>
    </div>
  );
}
