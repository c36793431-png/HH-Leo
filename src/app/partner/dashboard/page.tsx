import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getPartnerByUserId,
  listDealsForPartner,
  listPaymentsForDeal,
  summarizeDealCycle,
  type PartnerDealRow,
  type DealPaymentRow,
} from "@/lib/partners";

function fmt(n: number): string {
  return `$${n.toFixed(0)}`;
}

function initial(s: string): string {
  return s.trim().charAt(0).toUpperCase() || "?";
}

const LIFECYCLE_BADGE: Record<PartnerDealRow["status"], string> = {
  proposed: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  approved: "border-blue-400/40 bg-blue-400/10 text-blue-300",
  active: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  closed: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400",
  cancelled: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400",
};

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${className}`}
    >
      {children}
    </span>
  );
}

export default async function PartnerDashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const partner = await getPartnerByUserId(session.user.id);
  if (!partner) {
    return (
      <div className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6 text-sm text-zinc-400">
        No partner record is linked to this account yet.
      </div>
    );
  }

  const deals = await listDealsForPartner(partner.id);
  const dealsWithPayments = await Promise.all(
    deals.map(async (deal) => {
      const payments = await listPaymentsForDeal(deal.id);
      return { deal, payments, cycle: summarizeDealCycle(deal, payments) };
    })
  );

  const activeDeals = dealsWithPayments.filter((d) => d.deal.status === "active");
  const proposedDeals = dealsWithPayments.filter((d) => d.deal.status === "proposed");
  const closedDeals = dealsWithPayments.filter((d) => d.deal.status === "closed" || d.deal.status === "cancelled");

  const recurringShare = activeDeals
    .filter((d) => d.deal.cadence === "monthly")
    .reduce((sum, d) => sum + d.deal.grossUsd * d.deal.partnerPct, 0);
  const cycleOutstandingShare = activeDeals.reduce(
    (sum, d) => sum + d.cycle.outstanding * d.deal.partnerPct,
    0
  );
  const cycleCollectedShare = activeDeals.reduce((sum, d) => sum + d.cycle.collected * d.deal.partnerPct, 0);
  const lifetimeEarned = dealsWithPayments.reduce(
    (sum, d) => sum + d.payments.reduce((s, p) => s + p.amountUsd * d.deal.partnerPct, 0),
    0
  );

  return (
    <div className="flex flex-1 flex-col text-zinc-100">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Partner
        </span>
        <h1 className="mt-2 text-xl font-semibold">{partner.name}</h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          Propose a bespoke price and revenue split per client. Once Horizon approves, the deal activates and your
          share accrues on every billing cycle.
        </p>
        <a
          href="/partner/proposals/new"
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-black hover:bg-cyan-400"
        >
          + New proposal
        </a>
      </header>

      <section className="mb-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Your recurring share</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-400">
            {fmt(recurringShare)}
            <span className="ml-1 text-xs font-normal text-zinc-500">/mo</span>
          </div>
          <div className="mt-2 text-xs text-zinc-400">
            {activeDeals.filter((d) => d.deal.cadence === "monthly").length} active deal(s) · accrues monthly
          </div>
        </div>
        <div className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">This cycle outstanding</div>
          <div className="mt-1 text-2xl font-semibold text-amber-400">
            {fmt(cycleOutstandingShare)}
            <span className="ml-1 text-xs font-normal text-zinc-500">of {fmt(recurringShare)}</span>
          </div>
          <div className="mt-2 text-xs text-zinc-400">{fmt(cycleCollectedShare)} collected so far</div>
        </div>
        <div className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Lifetime earned</div>
          <div className="mt-1 text-2xl font-semibold">{fmt(lifetimeEarned)}</div>
          <div className="mt-2 text-xs text-zinc-400">Since first activation</div>
        </div>
        <div className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Deals</div>
          <div className="mt-1 text-2xl font-semibold">{deals.length}</div>
          <div className="mt-2 text-xs text-zinc-400">
            {activeDeals.length} active · {proposedDeals.length} proposed
          </div>
        </div>
      </section>
      <p className="mb-8 font-mono text-xs text-zinc-500">
        Your share is computed per confirmed payment. Numbers reflect payments Horizon has confirmed received.
      </p>

      <h2 className="mb-3 text-sm font-medium text-blue-400">Active deals</h2>
      <div className="mb-8 space-y-5">
        {activeDeals.length === 0 && <p className="text-sm text-zinc-500">No active deals yet.</p>}
        {activeDeals.map(({ deal, cycle }) => (
          <div key={deal.id} className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-700 bg-black/40 font-semibold text-cyan-300">
                  {initial(deal.clientEmail ?? "?")}
                </div>
                <div>
                  <div className="font-semibold text-zinc-100">{deal.clientEmail ?? "—"}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="border-violet-400/40 bg-violet-400/10 text-violet-300">
                  {deal.cadence === "monthly" ? "Monthly" : "One-time"}
                </Badge>
                <Badge className={LIFECYCLE_BADGE[deal.status]}>{deal.status}</Badge>
                {deal.cadence === "monthly" && (
                  <Badge className="border-amber-400/40 bg-amber-400/10 text-amber-300">
                    {cycle.settlement} {cycle.cycle ? `· ${cycle.cycle}` : ""}
                  </Badge>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 sm:grid-cols-4">
              <div className="bg-cyan-950/80 p-3">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Deal price</div>
                <div className="mt-1 text-lg font-semibold">
                  {fmt(deal.grossUsd)}
                  {deal.cadence === "monthly" && <span className="text-xs text-zinc-500">/mo</span>}
                </div>
              </div>
              <div className="bg-cyan-950/80 p-3">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                  Your share · {Math.round(deal.partnerPct * 100)}%
                </div>
                <div className="mt-1 text-lg font-semibold text-emerald-400">
                  {fmt(deal.grossUsd * deal.partnerPct)}
                  {deal.cadence === "monthly" && <span className="text-xs text-zinc-500">/mo</span>}
                </div>
              </div>
              <div className="bg-cyan-950/80 p-3">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                  Horizon · {Math.round(deal.coxwellPct * 100)}%
                </div>
                <div className="mt-1 text-lg font-semibold">{fmt(deal.grossUsd * deal.coxwellPct)}</div>
              </div>
              <div className="bg-cyan-950/80 p-3">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Cadence</div>
                <div className="mt-1 text-lg font-semibold">{deal.cadence === "monthly" ? "Monthly" : "One-time"}</div>
              </div>
            </div>

            {deal.cadence === "monthly" && (
              <div className="mt-4 rounded-lg border border-zinc-800 bg-black/30 p-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-zinc-400">
                  <span>
                    Current cycle — <b className="text-zinc-200">{cycle.cycle}</b> · collection progress
                  </span>
                  <span className="font-mono text-emerald-400">
                    {fmt(cycle.collected)} of {fmt(cycle.gross)}
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full border border-zinc-800 bg-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400"
                    style={{ width: `${cycle.gross > 0 ? Math.min(100, (cycle.collected / cycle.gross) * 100) : 0}%` }}
                  />
                </div>

                <PaymentTable payments={cycle.payments} partnerPct={deal.partnerPct} outstanding={cycle.outstanding} />
              </div>
            )}

            {deal.tiers.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">
                  Entitlements granted <span className="ml-2 rounded border border-violet-400/30 bg-violet-400/10 px-2 py-0.5 text-violet-300">bundle · {deal.tiers.length} tiers, one activation</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {deal.tiers.map((t) => (
                    <div key={t} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-black/30 px-3 py-2 font-mono text-xs text-zinc-200">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" /> {t}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <h2 className="mb-3 text-sm font-medium text-amber-400">Pending approval</h2>
      <div className="mb-8 space-y-2">
        {proposedDeals.length === 0 && <p className="text-sm text-zinc-500">No proposals waiting on Horizon.</p>}
        {proposedDeals.map(({ deal }) => (
          <div
            key={deal.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-black/30 p-4"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 bg-black/40 text-sm font-semibold text-zinc-300">
              {initial(deal.clientEmail ?? "?")}
            </div>
            <div className="min-w-0">
              <div className="font-medium text-zinc-100">{deal.clientEmail ?? "—"}</div>
              <div className="font-mono text-[11px] text-zinc-500">proposed {deal.createdAt.toISOString().slice(0, 10)}</div>
            </div>
            <Badge className="border-violet-400/40 bg-violet-400/10 text-violet-300">
              {deal.cadence === "monthly" ? "Monthly" : "One-time"}
            </Badge>
            <Badge className={LIFECYCLE_BADGE[deal.status]}>{deal.status}</Badge>
            <div className="ml-auto text-right">
              <div className="font-semibold">
                {fmt(deal.grossUsd)}
                {deal.cadence === "monthly" && <span className="text-xs text-zinc-500">/mo</span>}
              </div>
              <div className="text-[10px] text-zinc-500">
                your {Math.round(deal.partnerPct * 100)}% = {fmt(deal.grossUsd * deal.partnerPct)}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="mb-8 font-mono text-xs text-zinc-500">
        Proposed deals don&apos;t accrue until Horizon approves and the client&apos;s first payment lands.
      </p>

      <h2 className="mb-3 text-sm font-medium text-zinc-400">Closed</h2>
      <div className="space-y-2">
        {closedDeals.length === 0 && (
          <p className="text-sm text-zinc-500">No closed deals yet — your first deal is still active.</p>
        )}
        {closedDeals.map(({ deal }) => (
          <div key={deal.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black/20 p-4 opacity-75">
            <div className="text-sm text-zinc-300">{deal.clientEmail ?? "—"}</div>
            <Badge className={LIFECYCLE_BADGE[deal.status]}>{deal.status}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaymentTable({
  payments,
  partnerPct,
  outstanding,
}: {
  payments: DealPaymentRow[];
  partnerPct: number;
  outstanding: number;
}) {
  return (
    <table className="mt-4 w-full text-left text-xs">
      <thead className="text-zinc-500">
        <tr>
          <th className="pb-1 pr-4">Date received</th>
          <th className="pb-1 pr-4">Amount</th>
          <th className="pb-1 pr-4">Status</th>
          <th className="pb-1">Split (You / H)</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-900">
        {payments.map((p) => (
          <tr key={p.id}>
            <td className="py-2 pr-4 text-zinc-400">{p.receivedAt.toISOString().slice(0, 10)}</td>
            <td className="py-2 pr-4 font-mono text-zinc-200">${p.amountUsd.toFixed(0)}</td>
            <td className="py-2 pr-4">
              <span className="inline-flex items-center gap-1.5 text-emerald-400">
                <span className="text-emerald-400">✓</span> Received
                <span className="ml-1 font-mono text-[10px] text-zinc-500">
                  confirmed by Horizon · {p.receivedAt.toISOString().slice(0, 10)}
                </span>
              </span>
            </td>
            <td className="py-2 font-mono text-emerald-400">
              ${(p.amountUsd * partnerPct).toFixed(0)} / <span className="text-zinc-500">${(p.amountUsd * (1 - partnerPct)).toFixed(0)}</span>
            </td>
          </tr>
        ))}
        {outstanding > 0 && (
          <tr className="opacity-75">
            <td className="py-2 pr-4 text-zinc-600">—</td>
            <td className="py-2 pr-4 font-mono text-amber-400">${outstanding.toFixed(0)}</td>
            <td className="py-2 pr-4">
              <span className="inline-flex items-center gap-1.5 text-amber-400">
                Awaiting confirmation
                <span className="ml-1 font-mono text-[10px] text-zinc-500">outstanding this cycle</span>
              </span>
            </td>
            <td className="py-2 font-mono text-zinc-500">
              ${(outstanding * partnerPct).toFixed(0)} / ${(outstanding * (1 - partnerPct)).toFixed(0)}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
