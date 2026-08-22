import {
  listPartners,
  listProposedDeals,
  listAllDeals,
  listPaymentsForDeal,
  summarizeDealCycle,
} from "@/lib/partners";
import { ReviewActions, RecordPaymentForm } from "@/components/admin/partner-approval-queue-actions";

function fmt(n: number): string {
  return `$${n.toFixed(0)}`;
}

function initial(s: string): string {
  return s.trim().charAt(0).toUpperCase() || "?";
}

export default async function AdminPartnerApprovalQueuePage() {
  const [partners, proposedDeals, allDeals] = await Promise.all([
    listPartners(),
    listProposedDeals(),
    listAllDeals(),
  ]);

  const activeDeals = allDeals.filter((d) => d.status === "active");
  const activeWithLedger = await Promise.all(
    activeDeals.map(async (deal) => {
      const payments = await listPaymentsForDeal(deal.id);
      return { deal, payments, cycle: summarizeDealCycle(deal, payments) };
    })
  );

  const partnerById = new Map(partners.map((p) => [p.id, p]));

  const horizonCutMrr = activeDeals
    .filter((d) => d.cadence === "monthly")
    .reduce((sum, d) => sum + d.grossUsd * d.coxwellPct, 0);
  const outstandingHorizonCut = activeWithLedger.reduce((sum, d) => sum + d.cycle.outstanding * d.deal.coxwellPct, 0);

  return (
    <div className="flex flex-1 flex-col text-zinc-100">
      <header className="mb-6">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Partner deals
        </span>
        <h1 className="mt-2 text-xl font-semibold">Approval queue &amp; receivables</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Partner-proposed deals awaiting your decision, plus the per-deal receivable ledger for active deals.
        </p>
      </header>

      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-amber-400/40 bg-zinc-900/60 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Awaiting approval</div>
          <div className="mt-1 text-2xl font-semibold text-amber-400">{proposedDeals.length}</div>
        </div>
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Active deals</div>
          <div className="mt-1 text-2xl font-semibold">{activeDeals.length}</div>
        </div>
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Horizon cut · MRR</div>
          <div className="mt-1 text-2xl font-semibold">
            {fmt(horizonCutMrr)}
            <span className="ml-1 text-xs font-normal text-zinc-500">/mo</span>
          </div>
        </div>
        <div className="rounded-xl border border-amber-400/40 bg-zinc-900/60 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Outstanding this cycle</div>
          <div className="mt-1 text-2xl font-semibold text-amber-400">{fmt(outstandingHorizonCut)}</div>
        </div>
      </section>

      <h2 className="mb-3 text-sm font-medium text-amber-400">Approval queue</h2>
      <div className="mb-10 space-y-4">
        {proposedDeals.length === 0 && <p className="text-sm text-zinc-500">Nothing pending review.</p>}
        {proposedDeals.map((deal) => {
          const partner = partnerById.get(deal.partnerId);
          return (
            <div key={deal.id} className="rounded-xl border border-amber-400/40 bg-cyan-950/40 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 bg-black/40 font-semibold text-cyan-300">
                      {initial(partner?.name ?? "?")}
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-violet-400">Partner</div>
                      <div className="font-semibold">{partner?.name ?? "—"}</div>
                      <div className="font-mono text-[10px] text-zinc-500">
                        {partner?.handle ?? ""} {partner?.email ? `· ${partner.email}` : ""}
                      </div>
                    </div>
                  </div>
                  <span className="text-zinc-600">→</span>
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 bg-black/40 font-semibold text-amber-300">
                      {initial(deal.clientEmail ?? "?")}
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-blue-400">Client</div>
                      <div className="font-semibold">{deal.clientEmail ?? "—"}</div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/40 bg-violet-400/10 px-2.5 py-1 text-[10px] font-bold uppercase text-violet-300">
                    {deal.cadence === "monthly" ? "Monthly" : "One-time"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-300">
                    Proposed
                  </span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 sm:grid-cols-4">
                <div className="bg-zinc-900/80 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500">Suggested price</div>
                  <div className="mt-1 text-lg font-semibold">
                    {fmt(deal.grossUsd)}
                    {deal.cadence === "monthly" && <span className="text-xs text-zinc-500">/mo</span>}
                  </div>
                </div>
                <div className="bg-zinc-900/80 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500">Partner share</div>
                  <div className="mt-1 text-lg font-semibold text-emerald-400">
                    {Math.round(deal.partnerPct * 100)}% · {fmt(deal.grossUsd * deal.partnerPct)}
                  </div>
                </div>
                <div className="bg-zinc-900/80 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500">Horizon keeps</div>
                  <div className="mt-1 text-lg font-semibold">
                    {Math.round(deal.coxwellPct * 100)}% · {fmt(deal.grossUsd * deal.coxwellPct)}
                  </div>
                </div>
                <div className="bg-zinc-900/80 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500">Bundle</div>
                  <div className="mt-1 text-lg font-semibold">{deal.tiers.length} tiers</div>
                </div>
              </div>

              {deal.tiers.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {deal.tiers.map((t) => (
                    <span key={t} className="rounded-md border border-zinc-800 bg-black/30 px-2.5 py-1 font-mono text-xs text-zinc-300">
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {deal.proposalNote && (
                <div className="mt-3 rounded-lg border-l-2 border-blue-400/60 bg-black/20 p-3 text-xs text-zinc-300">
                  <b className="text-zinc-100">Partner note:</b> &ldquo;{deal.proposalNote}&rdquo;
                </div>
              )}

              <div className="mt-4">
                <ReviewActions dealId={deal.id} />
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="mb-3 text-sm font-medium text-emerald-400">Active deals</h2>
      <div className="space-y-5">
        {activeWithLedger.length === 0 && <p className="text-sm text-zinc-500">No active deals yet.</p>}
        {activeWithLedger.map(({ deal, cycle }) => {
          const partner = partnerById.get(deal.partnerId);
          return (
            <div key={deal.id} className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-zinc-300">
                  <b className="text-zinc-100">{deal.clientEmail ?? "—"}</b>
                  <span className="mx-2 text-zinc-600">·</span>
                  via <b className="text-zinc-100">{partner?.name ?? "—"}</b>
                </div>
                <div className="flex gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/40 bg-violet-400/10 px-2.5 py-1 text-[10px] font-bold uppercase text-violet-300">
                    {deal.cadence === "monthly" ? "Monthly" : "One-time"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold uppercase text-emerald-300">
                    Active
                  </span>
                  {deal.cadence === "monthly" && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-300">
                      {cycle.settlement} {cycle.cycle ? `· ${cycle.cycle}` : ""}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-zinc-800 bg-black/20 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <b className="text-sm">Payment ledger</b>
                  <span className="font-mono text-[11px] text-zinc-500">
                    deal_id {deal.id.slice(0, 8)} · {deal.cadence === "monthly" ? "recurring monthly" : "one-time"}
                  </span>
                </div>

                <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">Horizon cut · this cycle</div>
                    <div className="mt-1 text-xl font-semibold">{fmt(cycle.gross * deal.coxwellPct)}</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">Received</div>
                    <div className="mt-1 text-xl font-semibold text-emerald-400">{fmt(cycle.collected * deal.coxwellPct)}</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">Outstanding</div>
                    <div className="mt-1 text-xl font-semibold text-amber-400">{fmt(cycle.outstanding * deal.coxwellPct)}</div>
                  </div>
                </div>

                <div className="mb-3 h-2.5 w-full overflow-hidden rounded-full border border-zinc-800 bg-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400"
                    style={{
                      width: `${cycle.gross > 0 ? Math.min(100, (cycle.collected / cycle.gross) * 100) : 0}%`,
                    }}
                  />
                </div>

                <div className="mb-4 rounded-lg border-l-2 border-violet-400/60 bg-black/20 p-3 text-xs text-zinc-300">
                  Net-settle: the partner collects the full <b className="text-zinc-100">{fmt(cycle.gross)}</b> from the
                  client off-portal, keeps their <b className="text-zinc-100">{Math.round(deal.partnerPct * 100)}%</b>{" "}
                  at source, and pays Horizon only its{" "}
                  <b className="text-zinc-100">
                    {Math.round(deal.coxwellPct * 100)}% cut ({fmt(deal.grossUsd * deal.coxwellPct)}
                    {deal.cadence === "monthly" ? "/cycle" : ""})
                  </b>
                  . This ledger tracks that cut — Received vs. Outstanding. Horizon never handles the client&apos;s
                  payment.
                </div>

                <table className="w-full text-left text-xs">
                  <thead className="text-zinc-500">
                    <tr>
                      <th className="pb-1 pr-4">Date</th>
                      <th className="pb-1 pr-4">Amount · Horizon cut</th>
                      <th className="pb-1">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    {cycle.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2 pr-4 text-zinc-400">{p.receivedAt.toISOString().slice(0, 10)}</td>
                        <td className="py-2 pr-4 font-mono text-zinc-200">${(p.amountUsd * deal.coxwellPct).toFixed(0)}</td>
                        <td className="py-2 text-emerald-400">
                          ✓ Confirmed
                          <span className="ml-2 font-mono text-[10px] text-zinc-500">
                            by {p.confirmedBy ?? "—"} · {p.receivedAt.toISOString().slice(0, 10)}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {cycle.outstanding > 0 && (
                      <tr className="opacity-70">
                        <td className="py-2 pr-4 text-zinc-600">—</td>
                        <td className="py-2 pr-4 font-mono text-amber-400">
                          ${(cycle.outstanding * deal.coxwellPct).toFixed(0)}
                        </td>
                        <td className="py-2 text-amber-400">
                          Confirm received
                          <span className="ml-2 font-mono text-[10px] text-zinc-500">outstanding this cycle</span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                <div className="mt-4">
                  <RecordPaymentForm dealId={deal.id} />
                </div>
                <div className="mt-3 text-[11px] text-zinc-500">
                  ⓘ Any portal-billed base-license payment lives on the client&apos;s account record — it&apos;s not
                  part of this partner-cut payment ledger.
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-6 rounded-lg border border-violet-400/20 bg-violet-400/5 p-3 text-[11px] text-zinc-400">
                <div>
                  <b className="block text-zinc-100">Lifecycle</b>
                  <span className="font-mono text-violet-300">proposed → approved → active → closed</span>
                </div>
                <div>
                  <b className="block text-zinc-100">Settlement · per cycle</b>
                  <span className="font-mono text-amber-300">promised → partial → settled</span>
                </div>
                <div className="ml-auto">
                  <b className="block text-zinc-100">This deal</b>
                  <span className="font-mono text-zinc-300">
                    {deal.status} + {cycle.settlement} — activation ≠ full payment
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
