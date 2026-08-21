import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPartnerByUserId, listDealsForPartner, listPaymentsForDeal } from "@/lib/partners";

function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
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
    deals.map(async (deal) => ({ deal, payments: await listPaymentsForDeal(deal.id) }))
  );

  const totalGross = deals.reduce((sum, d) => sum + d.grossUsd, 0);
  const totalShare = deals.reduce((sum, d) => sum + d.grossUsd * d.partnerPct, 0);
  const totalReceived = deals.reduce((sum, d) => sum + d.receivedUsd, 0);

  return (
    <div className="flex flex-1 flex-col text-zinc-100">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Partner
        </span>
        <h1 className="mt-2 text-xl font-semibold">{partner.name}</h1>
      </header>

      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Total gross</div>
          <div className="mt-1 text-2xl font-semibold">{fmt(totalGross)}</div>
        </div>
        <div className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Your share</div>
          <div className="mt-1 text-2xl font-semibold">{fmt(totalShare)}</div>
        </div>
        <div className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Received</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-400">{fmt(totalReceived)}</div>
        </div>
      </section>

      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <h2 className="text-sm font-medium text-blue-400">Deals</h2>
        <div className="mt-4 space-y-6">
          {dealsWithPayments.map(({ deal, payments }) => (
            <div key={deal.id} className="rounded-lg border border-zinc-800 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-zinc-200">{deal.clientEmail ?? "—"}</span>
                <span className="text-xs uppercase tracking-wide text-zinc-500">{deal.status}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-400 sm:grid-cols-3">
                <div>
                  Gross <span className="text-zinc-200">{fmt(deal.grossUsd)}</span>
                </div>
                <div>
                  Your share ({Math.round(deal.partnerPct * 100)}%){" "}
                  <span className="text-zinc-200">{fmt(deal.grossUsd * deal.partnerPct)}</span>
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
                      <th className="pb-1">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-1 pr-4 text-zinc-400">{p.receivedAt.toISOString().slice(0, 10)}</td>
                        <td className="py-1 text-zinc-200">{fmt(p.amountUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          {dealsWithPayments.length === 0 && <p className="text-sm text-zinc-500">No deals yet.</p>}
        </div>
      </section>
    </div>
  );
}
