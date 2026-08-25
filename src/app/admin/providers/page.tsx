import Link from "next/link";
import { formatRelative } from "@/lib/format-time";
import { getBookContext, getTermsQueueStats, listTermsReviewQueue } from "@/lib/provider-terms-queue";
import type { TermsQueueRow } from "@/lib/provider-terms-queue";
import { listProviderRoster } from "@/lib/provider-tiers";
import { TermsQueueRowActions } from "@/components/admin/terms-queue-row-actions";
import { confirmProposalAction } from "./actions";

interface ProviderQueueGroup {
  providerUserId: string;
  providerName: string;
  rows: TermsQueueRow[];
}

/** Spec §3.5: a provider with >1 pending proposal renders as one grouped block --
 * provider identity once, decided per tier. Grouped by providerUserId, not
 * applicationId: provider_applications has no unique constraint on email/user_id,
 * so the same provider can hold two application rows -- grouping by applicationId
 * would split one provider across two blocks. Groups keep the queue's existing
 * oldest-waiting-first order by sorting on each group's earliest row. */
function groupQueueByProvider(queue: TermsQueueRow[]): ProviderQueueGroup[] {
  const groups = new Map<string, ProviderQueueGroup>();
  for (const row of queue) {
    let group = groups.get(row.providerUserId);
    if (!group) {
      group = { providerUserId: row.providerUserId, providerName: row.providerName, rows: [] };
      groups.set(row.providerUserId, group);
    }
    group.rows.push(row);
  }
  return Array.from(groups.values()).sort(
    (a, b) => a.rows[0].createdAt.getTime() - b.rows[0].createdAt.getTime()
  );
}

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

  const [stats, bookContext, queue, roster] = await Promise.all([
    getTermsQueueStats(),
    getBookContext(),
    listTermsReviewQueue(),
    listProviderRoster(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            Admin · Providers
          </span>
          <h1 className="mt-2 text-lg font-medium text-zinc-100">Providers</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {roster.length} approved provider{roster.length === 1 ? "" : "s"} · terms negotiation queue and
            provider roster.
          </p>
        </div>
        <Link
          href="/admin/register-provider"
          className="rounded-lg border border-teal-400/40 bg-teal-950/30 px-3 py-2 text-sm font-medium text-teal-300 hover:bg-teal-950/50"
        >
          Register provider
        </Link>
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

      {stats.needsTermsReviewCount > 0 && filter !== "needs-review" && (
        <Link
          href="/admin/providers?filter=needs-review"
          className="mb-4 flex items-center justify-between rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-2.5 text-sm text-red-300 hover:bg-red-950/30"
        >
          <span>
            {stats.needsTermsReviewCount} tier{stats.needsTermsReviewCount === 1 ? "" : "s"} need terms review
          </span>
          <span className="text-red-400/70">review now →</span>
        </Link>
      )}

      {filter === "trial" ? (
        <section className="flex flex-col gap-4">
          <p className="text-sm text-zinc-400">
            Not yet wired up — there&apos;s no trial state on provider_tiers to filter by yet.
            This will show providers currently in trial once that lands.
          </p>
        </section>
      ) : filter === "all" || filter === "live" ? (
        <section className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900/60 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Provider</th>
                <th className="px-4 py-2.5 font-medium">Feed(s) / tier</th>
                <th className="px-4 py-2.5 font-medium">Revenue share</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {roster
                .filter((entry) => filter === "all" || entry.status === "live")
                .map((entry) => (
                  <tr key={entry.applicationId}>
                    <td className="px-4 py-3 text-zinc-100">
                      <span className="flex items-center gap-2">
                        {entry.providerName}
                        {entry.source === "admin_manual" && (
                          <span
                            title={`Registered manually by ${entry.reviewedByLabel ?? "an admin"}`}
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 bg-zinc-800"
                          >
                            Manual
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">
                      {entry.tiers.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          {entry.tiers.map((tier) => (
                            <span key={tier.tierName}>{tier.tierName}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-300">
                      {entry.tiers.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          {entry.tiers.map((tier) => (
                            <span key={tier.tierName}>
                              {fmtUsd(tier.clientPriceCents)}/mo · provider {tier.providerSplitPct}%
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          entry.status === "live"
                            ? "border-cyan-400/40 bg-cyan-950/40 text-cyan-300"
                            : "border-zinc-600 bg-zinc-800/60 text-zinc-400"
                        }`}
                      >
                        {entry.status === "live" ? "Live" : "Onboarding"}
                      </span>
                    </td>
                  </tr>
                ))}
              {roster.filter((entry) => filter === "all" || entry.status === "live").length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                    No providers to show.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          {groupQueueByProvider(queue).map((group) => (
            <div
              key={group.providerUserId}
              className={group.rows.length > 1 ? "rounded-xl border border-teal-400/25 bg-teal-950/10 p-2" : undefined}
            >
              {group.rows.length > 1 && (
                <div className="mb-2 flex items-center gap-2 px-2 pt-1">
                  <span className="text-sm font-medium text-teal-400">{group.providerName}</span>
                  <span className="rounded-full border border-teal-400/40 bg-teal-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-300">
                    {group.rows.length} tiers in flight
                  </span>
                  <span className="text-[11px] text-teal-400/70">confirm each tier on its own — terms differ per tier</span>
                </div>
              )}
              <div className="flex flex-col gap-3">
                {group.rows.map((row) => (
                  <div
                    key={row.proposalId}
                    className={`rounded-xl border-l-4 border border-zinc-800 bg-zinc-900/60 p-4 ${
                      row.thinMargin ? "border-l-amber-500" : "border-l-cyan-400/60"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          {group.rows.length === 1 && (
                            <span className="text-sm font-medium text-teal-400">{row.providerName}</span>
                          )}
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
