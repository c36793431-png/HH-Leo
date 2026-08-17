import { listPayments, getPaymentTotals, listUserEmailsForAutocomplete } from "@/lib/payments";
import { formatAbsoluteUtc } from "@/lib/format-time";
import { AddPaymentForm } from "@/components/admin/add-payment-form";
import { PaymentRowActions } from "@/components/admin/payment-row-actions";

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  customer: "Customer",
  partner: "Partner",
  affiliate: "Affiliate",
  feed_provider: "Feed provider",
  infra: "Infra",
  other: "Other",
  referral_payout: "Referral payout",
};

const CATEGORY_STYLES: Record<string, string> = {
  customer: "text-emerald-400",
  partner: "text-cyan-400",
  affiliate: "text-blue-400",
  feed_provider: "text-amber-400",
  infra: "text-purple-400",
  other: "text-zinc-400",
  referral_payout: "text-pink-400",
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
        <p className="mt-2 text-sm text-zinc-400">Money in from customers, money out to vendors/partners — manually logged, newest first.</p>
      </header>

      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Gross in" value={fmt(totals.grossIn)} sub={`This month: ${fmt(totals.grossInThisMonth)}`} />
        <StatTile label="Total out" value={fmt(totals.totalOut)} sub={`This month: ${fmt(totals.totalOutThisMonth)}`} />
        <StatTile label="Net" value={fmt(totals.net)} sub={`This month: ${fmt(totals.netThisMonth)}`} />
      </section>

      <section className="mb-8 rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <h2 className="text-sm font-medium text-cyan-400">Add payment</h2>
        <div className="mt-4">
          <AddPaymentForm userEmails={userEmails} />
        </div>
      </section>

      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <h2 className="text-sm font-medium text-blue-400">All payments</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Direction</th>
                <th className="pb-2 pr-4">Amount</th>
                <th className="pb-2 pr-4">Category</th>
                <th className="pb-2 pr-4">Counterparty</th>
                <th className="pb-2 pr-4">Memo</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 pr-4 text-zinc-400" title={formatAbsoluteUtc(p.receivedAt)}>
                    {p.receivedAt.toISOString().slice(0, 10)}
                  </td>
                  <td className={`py-2 pr-4 font-medium ${p.direction === "in" ? "text-emerald-400" : "text-red-400"}`}>
                    {p.direction === "in" ? "↓ In" : "↑ Out"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-200">
                    {p.currency === "USD" ? "$" : `${p.currency} `}
                    {p.amountUsd.toFixed(2)}
                  </td>
                  <td className={`py-2 pr-4 ${CATEGORY_STYLES[p.category] ?? "text-zinc-400"}`}>
                    {CATEGORY_LABELS[p.category] ?? p.category}
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">
                    {p.counterparty ?? "—"}
                    {p.activationSource !== "paid" && (
                      <span className="ml-2 rounded border border-zinc-600 px-1 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                        {p.activationSource}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-zinc-500">{p.memo ?? "—"}</td>
                  <td className="py-2">
                    <PaymentRowActions payment={p} />
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-zinc-500">
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
