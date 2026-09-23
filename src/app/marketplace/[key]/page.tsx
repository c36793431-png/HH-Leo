import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { feedTierMeta } from "@/lib/feed-tier-catalogue";
import { getTiersForRegion } from "@/lib/feed-tiers";
import { MARKETPLACE_AVAILABILITY_LABELS, listingWithDetailPage } from "@/lib/marketplace-catalogue";
import { getTierRequestContext } from "@/lib/tier-request-context";
import { TierRequestControl } from "@/components/feeds/tier-request-control";

/**
 * /marketplace/[key]: the product page a listing card opens (coxwell 2026-09-23 via marcus,
 * m52432/m52443: card → "See more" → product page → Request access). Chicago is the only
 * listing with one today, set by hasDetailPage in marketplace-catalogue.ts. Every other key 404s.
 *
 * REQUEST, NOT BUY, AND NO PRICE. coxwell ruled no checkout, and prices are agreed over
 * Telegram (m52454 (a)). The control is the shipped TierRequestControl: it goes through
 * submitFeedTierRequestAction to the normal admin queue and the Telegram DM, with the same
 * Requested/Approved states as the tiers page. There is no second request flow.
 *
 * EVERYTHING ON THE SPEC PLATE IS THE feed_tiers ROW. Delivery is `subtitle` and coverage is
 * `description`, both from marcus's INSERT off provider_tiers dff16179. Nothing is copied into
 * code. No latency, redundancy or support figure is shown: the row has no measured latency,
 * and redundancy and support are '—' until FOC13 sources them. Host and port are fulfilment
 * detail and never reach this page.
 *
 * LAYOUT follows Iris's 09-18 product-available.html (m52499–m52503): an identity block, then
 * the spec on the left and the request box on the right. It takes none of her inventory: no
 * stepper, no measured-not-reviewed panel, no steps list, no price or "Negotiated" slot. The
 * image, flag and What's-included slots render only when the listing carries them, and today
 * none does. Iris's assets fill them later (m52454).
 *
 * ONE TIER PER PRODUCT PAGE. One request control can only submit one tier_key. A listing
 * flagged for a page but not backed by exactly one row 404s. The alternative is a page with a
 * button that submits the wrong thing, or nothing.
 */
export default async function MarketplaceProductPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const listing = listingWithDetailPage(key);
  if (!listing || listing.tierKeys.length !== 1) notFound();
  const tierKey = listing.tierKeys[0];
  const tierMeta = feedTierMeta(tierKey);
  if (!tierMeta) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const switchablePanels = getReachablePanels(session.user.roles);
  if (isAdminUser(session.user)) redirect("/admin/dashboard");

  const isAdmin = isAdminUser(session.user);
  const activeLicenses = await getActiveLicenseDetailsForUser(session.user.id).catch(() => []);
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  // The shipped query, as /marketplace uses it. A missing row means there is nothing to
  // request, so the page 404s, the same way the card leaves the catalogue.
  const row = (await getTiersForRegion(tierMeta.region)).find((t) => t.tierKey === tierKey);
  if (!row) notFound();

  const requestable = listing.availability === "available";
  const { serverOptions, hasAnyRegisteredServer, requestStateFor, licenseTail } = requestable
    ? await getTierRequestContext(session.user.id, activeLicenses, tierMeta.region)
    : { serverOptions: [], hasAnyRegisteredServer: false, requestStateFor: () => "none" as const, licenseTail: "—" };

  const flags = listing.flagCountryCodes ?? [];
  const included = listing.included ?? [];

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      <div className="comm-head">
        <Link href="/marketplace" className="btn ghost sm mkd-back">
          ← Marketplace
        </Link>
        <div className="mkd-title-row">
          {flags.map((code) => (
            <span
              key={code}
              className={`fp-flag fi fi-${code.toLowerCase()}`}
              role="img"
              aria-label={`${code} flag`}
            />
          ))}
          <h1>{listing.title}</h1>
          <span className={`mkt-pill mkt-pill-${listing.availability}`}>
            {MARKETPLACE_AVAILABILITY_LABELS[listing.availability]}
          </span>
        </div>
        <p>{listing.blurb}</p>
      </div>

      <div className="mkd-grid">
        <div className="mkd-col">
          {listing.image && (
            // A static asset from /public with a known path, so a plain <img> is enough. No
            // next/image remote config is needed, and the image has no layout of its own to
            // guard: it fills the column width.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="mkd-image" src={listing.image} alt={listing.title} />
          )}

          <div className="card">
            <div className="mkd-plate-title">Specification</div>
            <dl className="mkd-spec">
              <dt>Delivery</dt>
              <dd>{row.subtitle}</dd>
              <dt>Coverage</dt>
              <dd>{row.description}</dd>
            </dl>
          </div>

          {included.length > 0 && (
            <div className="card">
              <div className="mkd-plate-title">What&apos;s included</div>
              <ul className="mkd-included">
                {included.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div id="request" className="card mkd-request">
          <div className="mkd-plate-title">Access</div>
          {requestable ? (
            <>
              <TierRequestControl
                region={tierMeta.region}
                tierKey={tierKey}
                tierName={tierMeta.name}
                requestState={requestStateFor(tierKey)}
                servers={serverOptions}
                hasAnyRegisteredServer={hasAnyRegisteredServer}
                fallbackLicenseTail={licenseTail}
              />
              <p className="fp-note">
                Access is granted to one registered server. Its IP is allowlisted once your request is approved.
              </p>
            </>
          ) : (
            /* The same predicate as the catalogue: a listing that is not available offers no
               control, not even a greyed one ("can be listed not requested"). */
            <p className="fp-note">Not open for requests right now.</p>
          )}
        </div>
      </div>

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
