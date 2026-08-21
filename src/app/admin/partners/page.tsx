import { listPartners, listAllDeals, listPaymentsForDeal } from "@/lib/partners";
import { AddPartnerForm, AddDealForm, ConfirmDealPaymentForm } from "@/components/admin/partner-action-buttons";

function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default async function AdminPartnersPage() {
  const [partners, deals] = await Promise.all([listPartners(), listAllDeals()]);
  const dealsWithPayments = await Promise.all(
    deals.map(async (deal) => ({ deal, payments: await listPaymentsForDeal(deal.id) }))
  );

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Partners
        </span>
        <p className="mt-2 text-sm text-zinc-400">
          Manually-onboarded partners with individually-negotiated gross deals — separate from the self-serve
          Referrals system.
        </p>
      </header>

      <section className="mb-8 rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <h2 className="text-sm font-medium text-cyan-400">Add partner</h2>
        <div className="mt-4">
          <AddPartnerForm />
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <h2 className="text-sm font-medium text-cyan-400">Add deal</h2>
        <div className="mt-4">
          {partners.length === 0 ? (
            <p className="text-sm text-zinc-500">Add a partner first.</p>
          ) : (
            <AddDealForm partners={partners.map((p) => ({ id: p.id, name: p.name }))} />
          )}
        </div>
      </section>

      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <h2 className="text-sm font-medium text-blue-400">Deals ledger</h2>
        <div className="mt-4 space-y-6">
          {dealsWithPayments.map(({ deal, payments }) => {
            const partner = partners.find((p) => p.id === deal.partnerId);
            const partnerShareUsd = deal.grossUsd * deal.partnerPct;
            const coxwellShareUsd = deal.grossUsd * deal.coxwellPct;
            return (
              <div key={deal.id} className="rounded-lg border border-zinc-800 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium text-zinc-100">{partner?.name ?? "—"}</span>
                    <span className="ml-2 text-zinc-500">→</span>
                    <span className="ml-2 text-zinc-300">{deal.clientEmail ?? "—"}</span>
                  </div>
                  <span className="text-xs uppercase tracking-wide text-zinc-500">{deal.status}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-400 sm:grid-cols-4">
                  <div>
                    Gross <span className="text-zinc-200">{fmt(deal.grossUsd)}</span>
                  </div>
                  <div>
                    Partner ({Math.round(deal.partnerPct * 100)}%) <span className="text-zinc-200">{fmt(partnerShareUsd)}</span>
                  </div>
                  <div>
                    Coxwell ({Math.round(deal.coxwellPct * 100)}%) <span className="text-zinc-200">{fmt(coxwellShareUsd)}</span>
                  </div>
                  <div>
                    Received <span className="text-emerald-400">{fmt(deal.receivedUsd)}</span>
                  </div>
                </div>

                {payments.length > 0 && (
                  <table className="mt-3 w-full text-left text-xs">
                    <thead className="text-zinc-500">
                      <tr>
                        <th className="pb-1 pr-4">Date</th>
                        <th className="pb-1 pr-4">Amount</th>
                        <th className="pb-1 pr-4">Confirmed by</th>
                        <th className="pb-1">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900">
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td className="py-1 pr-4 text-zinc-400">{p.receivedAt.toISOString().slice(0, 10)}</td>
                          <td className="py-1 pr-4 text-zinc-200">{fmt(p.amountUsd)}</td>
                          <td className="py-1 pr-4 text-zinc-400">{p.confirmedBy ?? "—"}</td>
                          <td className="py-1 text-zinc-400">{p.notes ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <div className="mt-3">
                  <ConfirmDealPaymentForm dealId={deal.id} />
                </div>
              </div>
            );
          })}
          {dealsWithPayments.length === 0 && <p className="text-sm text-zinc-500">No deals recorded yet.</p>}
        </div>
      </section>
    </div>
  );
}
