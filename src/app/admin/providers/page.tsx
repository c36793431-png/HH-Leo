import Link from "next/link";
import { formatRelative } from "@/lib/format-time";
import { getBookContext, getTermsQueueStats, listTermsReviewQueue } from "@/lib/provider-terms-queue";
import { TermsQueueRowActions } from "@/components/admin/terms-queue-row-actions";
import { confirmProposalAction } from "./actions";

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const FILTER_SEGMENTS = [
  { key: "all", label: "All providers" },
  { key: "needs-review", label: "Needs terms review" },
  { key: "live", label: "Live" },
  { key: "trial", label: "In trial" },
] as const;

export default async function AdminProvidersPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter: filterParam } = await searchParams;
  const filter = FILTER_SEGMENTS.some((s) => s.key === filterParam) ? filterParam! : "needs-review";

  const [stats, bookContext, queue] = await Promise.all([
    getTermsQueueStats(),
    getBookContext(),
    listTermsReviewQueue(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Providers
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Providers</h1>
        <p className="mt-1 text-sm text-zinc-400">Terms negotiation queue and live feed-provider book.</p>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-red-500/40 bg-red-950/20 p-4">
          <div className="text-[11px] uppercase tracking-wide text-red-400/80">Needs terms review</div>
          <div className="mt-1 text-2xl font-medium text-zinc-100">{stats.needsTermsReviewCount}</div>
        </div>
        <div className="rounded-xl border border-cyan-400/35 bg-cyan-950/30 p-4">
          <div className="text-[11px] uppercase tracking-wide text-cyan-400/80">Live providers</div>
          <div className="mt-1 text-2xl font-medium text-zinc-100">{stats.liveProvidersCount}</div>
        </div>
        <div className="rounded-xl border border-cyan-400/35 bg-cyan-950/30 p-4">
          <div className="text-[11px] uppercase tracking-wide text-cyan-400/80">Confirmed this month</div>
          <div className="mt-1 text-2xl font-medium text-zinc-100">{stats.confirmedThisMonth}</div>
        </div>
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-4">
          <div className="text-[11px] uppercase tracking-wide text-emerald-400/80">Horizon retained</div>
          <div className="mt-1 text-2xl font-medium text-emerald-300">{fmtUsd(stats.horizonRetainedRunRateCents)}/mo</div>
          <div className="mt-0.5 text-[10px] text-zinc-500">contracted run-rate, not reconciled</div>
        </div>
      </section>

      <div className="mb-4 flex gap-1 border-b border-zinc-800 text-sm">
        {FILTER_SEGMENTS.map((seg) => (
          <Link
            key={seg.key}
            href={`/admin/providers?filter=${seg.key}`}
            className={`border-b-2 px-3 py-2 ${
              filter === seg.key
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {seg.label}
          </Link>
        ))}
      </div>

      {filter !== "needs-review" ? (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
          {FILTER_SEGMENTS.find((s) => s.key === filter)?.label} isn&apos;t built yet — only the terms-review queue
          ships in this pass.
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          {queue.map((row) => (
            <div
              key={row.proposalId}
              className={`rounded-xl border-l-4 border border-zinc-800 bg-zinc-900/60 p-4 ${
                row.thinMargin ? "border-l-amber-500" : "border-l-cyan-400/60"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-teal-400">{row.providerName}</span>
                    <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                      Round {row.roundNumber}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-400">
                    {row.tierName} · {row.context}
                  </div>
                </div>

                <div className="text-right text-xs">
                  <div className="text-sm text-zinc-100">
                    {fmtUsd(row.clientPriceCents)}/mo · provider share {row.providerSplitPct}%
                  </div>
                  <div className={row.thinMargin ? "text-amber-400" : "text-emerald-400"}>
                    you keep {row.adminRetainedPct}% · {fmtUsd(row.adminRetainedMonthlyCents)}/mo
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <span className="text-xs text-zinc-500">waiting {formatRelative(row.createdAt)}</span>
                  <TermsQueueRowActions proposalId={row.proposalId} confirmAction={confirmProposalAction} />
                </div>
              </div>

              <div className="mt-3 border-t border-zinc-800 pt-2 text-[11px] text-teal-400/90">
                {bookContext.medianRetainedPct != null ? (
                  <>
                    At {row.adminRetainedPct}% retained, book median is {Math.round(bookContext.medianRetainedPct)}%
                    across {bookContext.liveProviderTierCount} live tier
                    {bookContext.liveProviderTierCount === 1 ? "" : "s"}
                    {row.roundNumber > 1 && (
                      <>
                        {" "}
                        · their round-1 ask was {row.round1SplitPct}% provider share — you&apos;re{" "}
                        {Math.abs(row.negotiationDeltaPct)}pt{Math.abs(row.negotiationDeltaPct) === 1 ? "" : "s"}{" "}
                        {row.negotiationDeltaPct < 0 ? "up" : "down"} from there
                      </>
                    )}
                  </>
                ) : (
                  "No live tiers yet — book context has no baseline."
                )}
              </div>
            </div>
          ))}

          {queue.length === 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
              Nothing needs terms review right now.
            </div>
          )}

          <p className="mt-1 text-[11px] text-zinc-600">
            The &ldquo;you keep&rdquo; figure is admin-only — it never renders on the provider&rsquo;s My Terms.
          </p>
        </section>
      )}
    </div>
  );
}
