import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getPartnerByUserId,
  listDealsForPartner,
  listPaymentsForDeal,
  summarizePartnerTotals,
  type PartnerDealRow,
  type DealPaymentRow,
} from "@/lib/partners";

function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Stage 2 nav item #3 (bus thread partner-sidebar-stage2-2026-09-02, marcus: "re-slice by
 * payment, newest first" -- not by month, not by client). One row per deal_payments row
 * (Deals is one row per deal); the totals above the table reuse summarizePartnerTotals(),
 * the same function Overview's hero KPIs call, so the two pages can't disagree about
 * money. */
export default async function PartnerEarningsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const partner = await getPartnerByUserId(session.user.id);
  if (!partner) {
    return (
      <div className="pd-deals-empty">
        <h3>No partner record linked</h3>
        <p>Your account isn&apos;t linked to a partner record yet. Contact Horizon if this looks wrong.</p>
      </div>
    );
  }

  const deals = await listDealsForPartner(partner.id);
  const dealsWithPayments = await Promise.all(
    deals.map(async (deal) => ({ deal, payments: await listPaymentsForDeal(deal.id) }))
  );

  const { totalGrossUsd, yourShareUsd, receivedUsd } = summarizePartnerTotals(dealsWithPayments);

  const rows: { deal: PartnerDealRow; payment: DealPaymentRow }[] = dealsWithPayments
    .flatMap(({ deal, payments }) => payments.map((payment) => ({ deal, payment })))
    .sort((a, b) => b.payment.receivedAt.getTime() - a.payment.receivedAt.getTime());

  return (
    <>
      <div className="pd-page-head">
        <div className="h-txt">
          <div className="pd-eyebrow">
            <span className="dot" />
            Partner workspace
          </div>
          <h1>Earnings</h1>
          <p className="lead">Every payment Horizon has confirmed received against your deals, newest first.</p>
        </div>
      </div>

      <div className="pd-kpis">
        <div className="pd-kpi gross">
          <div className="k-lab">Total gross</div>
          <div className="k-val">
            <span className="cur">$</span>
            {totalGrossUsd.toFixed(2)}
          </div>
          <div className="k-sub">All-time, across every live deal</div>
        </div>
        <div className="pd-kpi share">
          <div className="k-lab">Your share</div>
          <div className="k-val">
            <span className="cur">$</span>
            {yourShareUsd.toFixed(2)}
          </div>
          <div className="k-sub">Accrued to date</div>
        </div>
        <div className="pd-kpi received">
          <span className="badge">Paid out</span>
          <div className="k-lab">Received</div>
          <div className="k-val">
            <span className="cur">$</span>
            {receivedUsd.toFixed(2)}
          </div>
          <div className="k-sub">Cleared to you so far</div>
        </div>
      </div>

      <div className="pd-sect-head">
        <span className="kick">Payments</span>
        <span className="sub">One row per confirmed payment</span>
        <span className="rule" />
        <span className="cnt">{rows.length} payment(s)</span>
      </div>

      {rows.length === 0 ? (
        <div className="pd-deals-empty">
          <h3>No earnings yet</h3>
          <p>
            A row appears here once Horizon confirms a payment received against one of your deals, and{" "}
            <b>your share starts accruing every cycle.</b>
          </p>
        </div>
      ) : (
        <div className="pd-tbl-wrap">
          <table className="pd-deal-tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Client</th>
                <th className="num">Deal / gross</th>
                <th className="num">Your split</th>
                <th className="num">Your share</th>
                <th>Confirmed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ deal, payment }) => (
                <tr key={payment.id}>
                  <td data-l="Date">{payment.receivedAt.toISOString().slice(0, 10)}</td>
                  <td data-l="Client">{deal.clientEmail ?? deal.clientName ?? "—"}</td>
                  <td className="num amt" data-l="Deal / gross">
                    {fmt(deal.grossUsd)}
                  </td>
                  <td className="num" data-l="Split">
                    {Math.round(deal.partnerPct * 100)}%
                  </td>
                  <td className="num amt mine" data-l="Your share">
                    {fmt(payment.amountUsd * deal.partnerPct)}
                  </td>
                  <td data-l="Confirmed">
                    <span className="pd-st pd-st-active">
                      <span className="d" />
                      Confirmed
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pd-note">
        Numbers reflect payments Horizon has confirmed received. Deal economics shown here are yours alone — no
        other partner&apos;s figures are visible.
      </div>
    </>
  );
}
