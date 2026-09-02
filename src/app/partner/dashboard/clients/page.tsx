import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPartnerByUserId, listDealsForPartner, summarizeClientsForPartner } from "@/lib/partners";
import { LIFECYCLE_CLASS } from "@/components/partner/deals-table";

function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Stage 2 nav item #4 (bus thread partner-sidebar-stage2-2026-09-02, marcus). No clients
 * table exists -- client identity is just client_user_id/client_email on partner_deals --
 * so this is a group-by over listDealsForPartner's rows via summarizeClientsForPartner(),
 * not new storage or a new query shape. Read-only: rows link nowhere, no client detail page
 * exists yet. */
export default async function PartnerClientsPage() {
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
  const clients = summarizeClientsForPartner(deals);

  return (
    <>
      <div className="pd-page-head">
        <div className="h-txt">
          <div className="pd-eyebrow">
            <span className="dot" />
            Partner workspace
          </div>
          <h1>Clients</h1>
          <p className="lead">Every client you&apos;ve brought a deal to, grouped from your deal history.</p>
        </div>
      </div>

      <div className="pd-sect-head">
        <span className="kick">Your clients</span>
        <span className="sub">One row per distinct client</span>
        <span className="rule" />
        <span className="cnt">{clients.length} client(s)</span>
      </div>

      {clients.length === 0 ? (
        <div className="pd-deals-empty">
          <h3>No clients yet</h3>
          <p>
            Clients appear here once you have at least one deal on record with Horizon. Propose a deal, and{" "}
            <b>this list fills in with their gross, your share, and deal status.</b>
          </p>
        </div>
      ) : (
        <div className="pd-tbl-wrap">
          <table className="pd-deal-tbl">
            <thead>
              <tr>
                <th>Client</th>
                <th className="num">Deals</th>
                <th className="num">Total gross</th>
                <th className="num">Your total share</th>
                <th>Most recent deal</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.clientUserId}>
                  <td data-l="Client">
                    <b>{client.clientLabel}</b>
                  </td>
                  <td className="num" data-l="Deals">
                    {client.dealCount}
                  </td>
                  <td className="num amt" data-l="Total gross">
                    {fmt(client.totalGrossUsd)}
                  </td>
                  <td className="num amt mine" data-l="Your total share">
                    {fmt(client.yourShareUsd)}
                  </td>
                  <td data-l="Most recent deal">
                    <span className={`pd-st ${LIFECYCLE_CLASS[client.mostRecentDealStatus]}`}>
                      <span className="d" />
                      {client.mostRecentDealStatus}
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
