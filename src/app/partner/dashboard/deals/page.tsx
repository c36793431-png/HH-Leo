import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  getPartnerByUserId,
  getPartnerReferralCode,
  listDealsForPartner,
  listPaymentsForDeal,
  summarizeDealCycle,
} from "@/lib/partners";
import { PartnerDealsTable } from "@/components/partner/deals-table";

/** Stage 1 nav item #2 (bus thread partner-sidebar-stage1-2026-09-01, marcus): "a lift of
 * existing data with no new storage and no new query shape" -- same listDealsForPartner /
 * listPaymentsForDeal rows the Overview deals card renders, as a full page instead of a
 * card. Overview's card is untouched; both share components/partner/deals-table.tsx so the
 * row markup can't drift between the two. No KPI trio or referral-link card here — those
 * stay Overview-only per the same thread. */
export default async function PartnerDealsPage() {
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

  return (
    <>
      <div className="pd-page-head">
        <div className="h-txt">
          <div className="pd-eyebrow">
            <span className="dot" />
            Partner workspace
          </div>
          <h1>Deals</h1>
          <p className="lead">Every referral you&apos;ve negotiated with Horizon, and where each one stands.</p>
        </div>
        <div className="h-cta">
          <a href="/partner/proposals/new" className="pd-btn amber">
            + New proposal <span className="ar">→</span>
          </a>
        </div>
      </div>

      <PartnerDealsTable dealsWithPayments={dealsWithPayments} referralLink={referralLink} />

      <div className="pd-note">
        Numbers reflect payments Horizon has confirmed received. Deal economics shown here are yours alone — no
        other partner&apos;s figures are visible.
      </div>
    </>
  );
}
