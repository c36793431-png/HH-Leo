import type { PartnerDealRow, DealPaymentRow } from "@/lib/partners";
import { CopyLinkButton } from "@/components/partner/copy-link-button";

export type DealWithPayments = { deal: PartnerDealRow; payments: DealPaymentRow[] };

function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

function initial(s: string): string {
  return s.trim().charAt(0).toUpperCase() || "?";
}

export const LIFECYCLE_CLASS: Record<PartnerDealRow["status"], string> = {
  proposed: "pd-st-proposed",
  approved: "pd-st-proposed",
  active: "pd-st-active",
  closed: "pd-st-closed",
  cancelled: "pd-st-closed",
};

/** Shared deals list -- rendered as a card on Overview and, unchanged, as the full
 * content of /partner/dashboard/deals (bus thread partner-sidebar-stage1-2026-09-01,
 * marcus: "a dedicated route rendering those same rows, full-page instead of a card,
 * is a lift of existing data"). Takes the already-fetched deal+payment rows so both
 * call sites share one query shape (listDealsForPartner/listPaymentsForDeal). */
export function PartnerDealsTable({
  dealsWithPayments,
  referralLink,
}: {
  dealsWithPayments: DealWithPayments[];
  referralLink?: string | null;
}) {
  const liveDeals = dealsWithPayments.filter((d) => d.deal.status !== "cancelled");
  const activeDeals = dealsWithPayments.filter((d) => d.deal.status === "active");
  const proposedDeals = dealsWithPayments.filter((d) => d.deal.status === "proposed" || d.deal.status === "approved");
  const closedDeals = dealsWithPayments.filter((d) => d.deal.status === "closed" || d.deal.status === "cancelled");

  return (
    <>
      <div className="pd-sect-head">
        <span className="kick">Your deals</span>
        <span className="sub">Negotiated referrals</span>
        <span className="rule" />
        <span className="cnt">{liveDeals.length} deal(s)</span>
      </div>

      {liveDeals.length === 0 ? (
        <div className="pd-deals-empty">
          <div className="de-seal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="m11 17 2 2a1 1 0 1 0 3-3" />
              <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
              <path d="m21 3 1 11h-2" />
              <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
              <path d="M3 4h8" />
            </svg>
          </div>
          <h3>No deals yet</h3>
          <p>
            Share your referral link, or propose a bespoke price and revenue split for a client. Once Horizon
            approves and the first payment lands, the deal activates and <b>your share starts accruing every cycle.</b>
          </p>
          <div className="de-cta">
            {referralLink && <CopyLinkButton link={referralLink} label="Copy referral link" />}
            <a href="/partner/proposals/new" className="pd-btn amber-ghost">
              + New proposal
            </a>
          </div>
        </div>
      ) : (
        <div className="pd-tbl-wrap">
          <table className="pd-deal-tbl">
            <thead>
              <tr>
                <th>Client</th>
                <th className="num">Deal / gross</th>
                <th className="num">Your split</th>
                <th className="num">Your share</th>
                <th className="num">Received</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {[...activeDeals, ...proposedDeals, ...closedDeals].map(({ deal, payments }) => {
                const receivedForDeal = payments.reduce((s, p) => s + p.amountUsd * deal.partnerPct, 0);
                const clientLabel = deal.clientEmail ?? "—";
                return (
                  <tr key={deal.id}>
                    <td data-l="Client">
                      <div className="pd-cl">
                        <span className="av">{initial(clientLabel)}</span>
                        <span className="who">
                          <b>{clientLabel}</b>
                        </span>
                      </div>
                    </td>
                    <td className="num amt" data-l="Deal / gross">
                      {fmt(deal.grossUsd)}
                      {deal.cadence === "monthly" && <span className="mut">/mo</span>}
                    </td>
                    <td className="num" data-l="Split">
                      {Math.round(deal.partnerPct * 100)}%
                    </td>
                    <td className="num amt mine" data-l="Your share">
                      {fmt(deal.grossUsd * deal.partnerPct)}
                      {deal.cadence === "monthly" && <span className="mut">/mo</span>}
                    </td>
                    <td className="num amt" data-l="Received">
                      {receivedForDeal > 0 ? fmt(receivedForDeal) : <span className="mut">— pending</span>}
                    </td>
                    <td data-l="Status">
                      <span className={`pd-st ${LIFECYCLE_CLASS[deal.status]}`}>
                        <span className="d" />
                        {deal.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="pd-tbl-foot">
            Your share is computed per payment <b>Horizon confirms received</b> — proposed deals don&apos;t accrue
            until approved.
          </div>
        </div>
      )}
    </>
  );
}
