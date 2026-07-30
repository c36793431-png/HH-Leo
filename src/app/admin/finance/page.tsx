import { listPayments, getPaymentTotals, listUserEmailsForAutocomplete } from "@/lib/payments";
import { formatAbsoluteUtc } from "@/lib/format-time";
import { AddPaymentForm } from "@/components/admin/add-payment-form";

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

const SOURCE_STYLES: Record<string, string> = {
  customer: "text-emerald-400",
  partner: "text-cyan-400",
  affiliate: "text-blue-400",
  other: "text-zinc-400",
};

function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default async function AdminFinancePage() {
  const [payments, totals, userEmails] = await Promise.all([
    listPayments(200),
    getPaymentTotals(),
    listUserEmailsForAutocomplete(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Finance
        </span>
        <p className="mt-2 text-sm text-zinc-400">Payments received — manually logged, newest first.</p>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="All-time received" value={fmt(totals.allTime)} />
        <StatTile label="This month" value={fmt(totals.thisMonth)} />
        <StatTile label="Customer" value={fmt(totals.bySourceTypeAllTime.customer)} />
        <StatTile label="Partner" value={fmt(totals.bySourceTypeAllTime.partner)} />
        <StatTile label="Affiliate" value={fmt(totals.bySourceTypeAllTime.affiliate)} />
        <StatTile label="Other" value={fmt(totals.bySourceTypeAllTime.other)} />
      </section>

      <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-cyan-400">Add payment</h2>
        <div className="mt-4">
          <AddPaymentForm userEmails={userEmails} />
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-blue-400">All payments</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Amount</th>
                <th className="pb-2 pr-4">Source</th>
                <th className="pb-2 pr-4">Counterparty</th>
                <th className="pb-2">Memo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 pr-4 text-zinc-400" title={formatAbsoluteUtc(p.receivedAt)}>
                    {p.receivedAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="py-2 pr-4 text-zinc-200">
                    {p.currency === "USD" ? "$" : `${p.currency} `}
                    {p.amountUsd.toFixed(2)}
                  </td>
                  <td className={`py-2 pr-4 ${SOURCE_STYLES[p.sourceType] ?? "text-zinc-400"}`}>{p.sourceType}</td>
                  <td className="py-2 pr-4 text-zinc-400">{p.counterparty ?? "—"}</td>
                  <td className="py-2 text-zinc-500">{p.memo ?? "—"}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-zinc-500">
                    No payments logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
