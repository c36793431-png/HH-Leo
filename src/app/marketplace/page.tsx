import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { FEED_REGIONS } from "@/lib/feed-tier-catalogue";
import { getTiersForRegion, type FeedTierDetail } from "@/lib/feed-tiers";
import { formatTierLatency } from "@/lib/feed-provider-packages";
import {
  MARKETPLACE_LISTINGS,
  MARKETPLACE_CATEGORY_ORDER,
  MARKETPLACE_CATEGORY_LABELS,
  MARKETPLACE_AVAILABILITY_LABELS,
} from "@/lib/marketplace-catalogue";

/**
 * /marketplace — the catalogue of what Horizon sells (coxwell via marcus, 2026-09-14).
 *
 * Auth is /feeds' auth and deliberately NOT paidOnly: a catalogue of what we sell has to be
 * visible to a free account, or it is a page only existing customers can read (marcus, m50717 #3).
 *
 * NO PRICES, ANYWHERE ON THIS PAGE. Every shipped buyer surface renders none, and publishing one
 * would be the first feed price Horizon has ever shown a customer — coxwell's, not this errand's
 * (marcus ruling, m50723 #1).
 *
 * NO NEW QUERY AND NO NEW DISPLAY RULE. Tiers come from the shipped getTiersForRegion, and a
 * tier's figure is rendered by the shipped formatTierLatency — London's feed_tiers.latency_us
 * holds FOC13's comparison SCORE rather than microseconds, so London renders "<score>/100" and
 * NY, whose latency_us is null, renders its bare "—" with no unit. Reusing the query is not by
 * itself enough to keep two surfaces agreeing, because the display rules live in the page, not
 * the lib — so this page reuses the rule too rather than restating it.
 */
export default async function MarketplacePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const switchablePanels = getReachablePanels(session.user.roles);
  if (isAdminUser(session.user)) redirect("/admin/dashboard");

  const isAdmin = isAdminUser(session.user);
  const activeLicenses = await getActiveLicenseDetailsForUser(session.user.id).catch(() => []);
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  // One call of the shipped query per declared region. A region with no rows (cme, tokyo today)
  // returns an empty list, which is why the declared listings below do not depend on it.
  const tierLists = await Promise.all(FEED_REGIONS.map((region) => getTiersForRegion(region).catch(() => [])));
  const tierByKey = new Map(tierLists.flat().map((t) => [t.tierKey, t]));

  const listings = MARKETPLACE_LISTINGS.map((listing) => ({
    listing,
    members: listing.tierKeys
      .map((key) => tierByKey.get(key))
      .filter((t): t is FeedTierDetail => t != null),
  })).filter(
    // A DECLARED listing (no tier keys at all) always renders — that is the point of declaring
    // it. A tier-backed listing whose rows have all gone renders nothing rather than an empty
    // card still advertising the product.
    ({ listing, members }) => listing.tierKeys.length === 0 || members.length > 0
  );

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      <div className="comm-head">
        <h1>Marketplace</h1>
        <p>Everything Horizon sells, by category — and what you can get today.</p>
      </div>

      {MARKETPLACE_CATEGORY_ORDER.map((category) => {
        const items = listings.filter(({ listing }) => listing.category === category);
        if (items.length === 0) return null;
        return (
          <div key={category} className="fp-section mkt-section">
            <h2 className="fp-section-title">{MARKETPLACE_CATEGORY_LABELS[category]}</h2>
            <div className="mkt-grid">
              {items.map(({ listing, members }) => (
                <div key={listing.key} className={`card mkt-card mkt-${listing.availability}`}>
                  <div className="mkt-top">
                    <span className={`mkt-pill mkt-pill-${listing.availability}`}>
                      {MARKETPLACE_AVAILABILITY_LABELS[listing.availability]}
                    </span>
                  </div>
                  <h3 className="mkt-name">{listing.title}</h3>
                  <p className="mkt-desc">{listing.blurb}</p>

                  {members.length > 0 && (
                    <div className="mkt-members">
                      <span className="mkt-members-label">Feed latency</span>
                      {members.map((m) => (
                        <div key={m.tierKey} className="mkt-member">
                          <span className="mkt-member-name">{m.name}</span>
                          <span className="mkt-member-figure">{formatTierLatency(m.regionKey, m)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* No CTA on a coming-soon or maintenance listing: "can be listed not
                      requested" means the action is absent, not disabled. */}
                  {listing.ctaHref && (
                    <Link href={listing.ctaHref} className="btn ghost sm mkt-cta">
                      {listing.ctaLabel}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <p className="fp-footnote">
        Availability shown here is the same state the rest of the portal renders. Need something
        that isn&apos;t listed? Ask on <Link href="/feeds">Feeds</Link> — we evaluate every request.
      </p>

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
