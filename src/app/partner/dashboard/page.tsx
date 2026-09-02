import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getPartnerByUserId,
  getPartnerReferralCode,
  listDealsForPartner,
  listPaymentsForDeal,
  summarizeDealCycle,
  summarizePartnerTotals,
} from "@/lib/partners";
import { CopyLinkButton } from "@/components/partner/copy-link-button";
import { PartnerDealsTable } from "@/components/partner/deals-table";

/** Rebuilt to match the V3-amber partner-dashboard mockup (brief
 * iris-partner-dashboard-design-2026-08-22, mockups/horizon-referral-partner/
 * partner-dashboard.html) — the amber shell now lives in dashboard/layout.tsx (a
 * PartnerSidebar, per partner-sidebar-stage1-2026-09-01), this renders the hero, referral
 * link, 3 KPI cards, and the deals list/empty-state (the latter shared with
 * /partner/dashboard/deals via components/partner/deals-table.tsx) the mockup specs. The
 * mockup also specs a "next-payout schedule strip" and a "referral activity funnel"
 * (clicks -> signups -> converted) as coxwell-optional additions to cut without backend
 * data — neither has one (no payout-cadence system, no click/attribution tracking table),
 * so both are omitted here. */
export default async function PartnerDashboardPage() {
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

  const [deals, referralCode, headerList] = await Promise.all([
    listDealsForPartner(partner.id),
    getPartnerReferralCode(session.user.id),
    headers(),
  ]);
  const dealsWithPayments = await Promise.all(
    deals.map(async (deal) => {
      const payments = await listPaymentsForDeal(deal.id);
      return { deal, payments, cycle: summarizeDealCycle(deal, payments) };
    })
  );

  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "horizonhft.com";
  const protocol = headerList.get("x-forwarded-proto") ?? "https";
  const referralLink = referralCode ? `${protocol}://${host}/signup?ref=${referralCode}` : null;

  const liveDeals = dealsWithPayments.filter((d) => d.deal.status !== "cancelled");
  const { totalGrossUsd, yourShareUsd, receivedUsd, avgSplitPct } = summarizePartnerTotals(dealsWithPayments);

  return (
    <>
      <div className="pd-hero">
        <div className="h-txt">
          <div className="pd-eyebrow">
            <span className="dot" />
            Partner workspace
          </div>
          <h1>
            Welcome back, <em>{partner.name}.</em>
          </h1>
          <p className="lead">
            Your referrals, deal economics, and payouts — tracked live. Share your link, propose a deal, and your
            share accrues the moment Horizon confirms a payment.
          </p>
        </div>
        <div className="h-cta">
          <a href="/partner/proposals/new" className="pd-btn amber">
            + New proposal <span className="ar">→</span>
          </a>
        </div>
      </div>

      {referralLink && (
        <div className="pd-reflink">
          <span className="rl-seal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </span>
          <div className="rl-txt">
            <div className="k">Your referral link</div>
            <div className="rl-url">
              <span className="u">{referralLink}</span>
              <span className="code">code · {referralCode}</span>
            </div>
          </div>
          <div className="rl-act">
            <CopyLinkButton link={referralLink} />
          </div>
        </div>
      )}

      <div className="pd-kpis">
        <div className="pd-kpi gross">
          <div className="k-lab">Total gross</div>
          <div className="k-val">
            <span className="cur">$</span>
            {totalGrossUsd.toFixed(2)}
          </div>
          <div className="k-sub">
            <b>{liveDeals.length} deal(s)</b> · lifetime deal volume
          </div>
        </div>
        <div className="pd-kpi share">
          <div className="k-lab">Your share</div>
          <div className="k-val">
            <span className="cur">$</span>
            {yourShareUsd.toFixed(2)}
          </div>
          <div className="k-sub">
            <b>~{avgSplitPct}% avg split</b> · accrued to date
          </div>
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

      <PartnerDealsTable dealsWithPayments={dealsWithPayments} referralLink={referralLink} />

      <div className="pd-note">
        Numbers reflect payments Horizon has confirmed received. Deal economics shown here are yours alone — no
        other partner&apos;s figures are visible.
      </div>

      <div className="pd-foot">
        <span className="fbrand">HORIZON HFT · © 2026 · Partner Program</span>
        <span className="fsp" />
        <a className="fpart" href="/partner/apply">
          Refer &amp; earn
        </a>
      </div>
    </>
  );
}
