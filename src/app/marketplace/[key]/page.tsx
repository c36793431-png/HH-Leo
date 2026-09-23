import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses, isPaidUser } from "@/lib/licenses";
import { getPortalConfig } from "@/lib/portal-config";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { feedTierMeta } from "@/lib/feed-tier-catalogue";
import { getTiersForRegion, type FeedTierDetail } from "@/lib/feed-tiers";
import { MARKETPLACE_AVAILABILITY_LABELS, listingByKey } from "@/lib/marketplace-catalogue";
import { getTierRequestContext } from "@/lib/tier-request-context";
import { TierRequestControl } from "@/components/feeds/tier-request-control";
import { ListingFigures, hasListingFigures, listingFigureMembers } from "@/components/marketplace/listing-figures";
import { ListingMedia } from "@/components/marketplace/listing-media";
import { FeedComparisonScores } from "@/components/feeds/feed-comparison-scores";
import { scoreNamesForTierKeys } from "@/lib/feed-comparison-scores";

/**
 * /marketplace/[key]: the product page behind every shelf card's "See more →" (coxwell
 * 2026-09-23 via marcus, m52432/m52443, and m52589: "See more should be for all of them").
 * Every listing has one, Not available ones included. An unknown key 404s.
 *
 * THE ACTION IS THE LISTING'S, AND ONLY WHEN IT IS AVAILABLE. A "request" listing renders the
 * shipped TierRequestControl, which goes through submitFeedTierRequestAction to the normal admin
 * queue and the Telegram DM, with the same Requested/Approved states as the tiers page. A "link"
 * listing hands off to the page that owns its flow. A "download" listing (the terminal) shows its
 * link to a licensed account and "Request access →" to Telegram to everyone else (m53009 (a)).
 * A listing that is not available offers nothing, even if the catalogue gave it an action by
 * mistake.
 *
 * REQUEST, NOT BUY, AND NO PRICE. coxwell ruled no checkout, and prices are agreed over
 * Telegram (m52454 (a)).
 *
 * THE SPEC PLATE IS CHICAGO'S ROW AND NOBODY ELSE'S. Delivery is `subtitle` and coverage is
 * `description`, both from marcus's INSERT off provider_tiers dff16179, read back live (m52454).
 * The London and NY rows' subtitle and description are not that: they carry latency claims
 * ("Minimum achievable latency", "fastest fixed-latency") that no buyer surface added since may
 * repeat, and the London subtitles contradict the comparison scores. So the plate renders only
 * for a "request" listing, and every other feed page shows its comparison figures from the same
 * block as its shelf card. Host and port are fulfilment detail and never reach this page.
 *
 * LAYOUT follows Iris's 09-18 product-available.html (m52499–m52503): an identity block, then
 * the product on the left and the Access box on the right. The hero image (with its flag or
 * plate) and What's included come from her 2026-09-23 delivery through the catalogue (m52632),
 * and each renders only when the listing carries it.
 *
 * THE COMPARISON sits below both, full width, "for reference" (coxwell via marcus, m52822/m52875):
 * the whole London leaderboard with this listing's own row(s) highlighted, in its marketplace
 * variant. It renders only for a listing with a row on the board, which is Black and the London
 * listings. NY and Chicago have no measurement, so they get nothing, not a placeholder.
 */
export default async function MarketplaceProductPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const listing = listingByKey(key);
  if (!listing) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const switchablePanels = getReachablePanels(session.user.roles);
  if (isAdminUser(session.user)) redirect("/admin/dashboard");

  const isAdmin = isAdminUser(session.user);
  const activeLicenses = await getActiveLicenseDetailsForUser(session.user.id).catch(() => []);
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  // The shipped query, as /marketplace uses it, once per region the listing's tiers live in. A
  // tier-backed listing whose rows have all gone 404s, the same way its card leaves the shelf.
  const regions = [...new Set(listing.tierKeys.flatMap((k) => feedTierMeta(k)?.region ?? []))];
  const rows = (await Promise.all(regions.map((r) => getTiersForRegion(r).catch(() => [])))).flat();
  const members = listing.tierKeys
    .map((k) => rows.find((t) => t.tierKey === k))
    .filter((t): t is FeedTierDetail => t != null);
  if (listing.tierKeys.length > 0 && members.length === 0) notFound();

  const action = listing.availability === "available" ? listing.action : null;

  // A request control submits one tier_key. A "request" listing not backed by exactly one row
  // 404s rather than rendering a button that submits the wrong thing, or nothing.
  let request: { row: FeedTierDetail; tierName: string; region: FeedTierDetail["regionKey"] } | null = null;
  if (action?.kind === "request") {
    const tierMeta = listing.tierKeys.length === 1 ? feedTierMeta(listing.tierKeys[0]) : null;
    if (!tierMeta || members.length !== 1) notFound();
    request = { row: members[0], tierName: tierMeta.name, region: tierMeta.region };
  }
  const requestContext = request
    ? await getTierRequestContext(session.user.id, activeLicenses, request.region)
    : null;

  // A "download" listing shows its link only to a licensed account (isPaidUser, as /dashboard).
  // Everyone else is sent to the /dashboard veil's Telegram upgrade path. A failed check fails
  // closed to Request access, never to Downloads.
  const download =
    action?.kind === "download"
      ? await Promise.all([isPaidUser(session.user.id).catch(() => false), getPortalConfig()]).then(
          ([licensed, config]) => ({ licensed, requestHref: config.telegramChannelUrl }),
        )
      : null;

  const figures = listingFigureMembers(listing, members);
  const included = listing.included ?? [];
  const comparisonOwnRows = scoreNamesForTierKeys(
    listing.scoreTierKey ? [...listing.tierKeys, listing.scoreTierKey] : listing.tierKeys,
  );
  // With no image, spec, figures or included list, the left column is empty and the Access box
  // would float alone at the far right. It takes the left edge instead. No listing hits this since
  // every one carries an image; it guards the next listing added without one.
  const leftEmpty = !listing.image && !request && !hasListingFigures(figures) && included.length === 0;

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      <div className="comm-head">
        <Link href="/marketplace" className="btn ghost sm mkd-back">
          ← Marketplace
        </Link>
        <div className="mkd-title-row">
          <h1>{listing.title}</h1>
          <span className={`mkt-pill mkt-pill-${listing.availability}`}>
            {MARKETPLACE_AVAILABILITY_LABELS[listing.availability]}
          </span>
        </div>
        <p>{listing.blurb}</p>
      </div>

      <div className={`mkd-grid${leftEmpty ? " mkd-grid-solo" : ""}`}>
        {!leftEmpty && (
          <div className="mkd-col">
            <ListingMedia listing={listing} variant="hero" />

            {request ? (
              <div className="card">
                <div className="mkd-plate-title">Specification</div>
                <dl className="mkd-spec">
                  <dt>Delivery</dt>
                  <dd>{request.row.subtitle}</dd>
                  <dt>Coverage</dt>
                  <dd>{request.row.description}</dd>
                </dl>
              </div>
            ) : (
              hasListingFigures(figures) && (
                <div className="card mkd-figures">
                  <ListingFigures members={figures} />
                </div>
              )
            )}

            {included.length > 0 && (
              <div className="card">
                <div className="mkd-plate-title">What&apos;s included</div>
                <ul className="mkd-included">
                  {included.map((item) =>
                    typeof item === "string" ? (
                      <li key={item}>{item}</li>
                    ) : (
                      <li key={item.label}>
                        <span className="mkd-included-label">{item.label}</span>
                        <ul>
                          {item.items.map((sub) => (
                            <li key={sub}>{sub}</li>
                          ))}
                        </ul>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        <div id="request" className="card mkd-request">
          <div className="mkd-plate-title">Access</div>
          {request && requestContext ? (
            <>
              <TierRequestControl
                region={request.region}
                tierKey={request.row.tierKey}
                tierName={request.tierName}
                requestState={requestContext.requestStateFor(request.row.tierKey)}
                servers={requestContext.serverOptions}
                hasAnyRegisteredServer={requestContext.hasAnyRegisteredServer}
                fallbackLicenseTail={requestContext.licenseTail}
              />
              <p className="fp-note">
                Access is granted to one registered server. Its IP is allowlisted once your request is approved.
              </p>
            </>
          ) : action?.kind === "download" && download ? (
            download.licensed ? (
              <Link href={action.href} className="btn primary sm mkd-action">
                {action.label}
              </Link>
            ) : (
              <a className="btn primary sm mkd-action" href={download.requestHref} target="_blank" rel="noopener noreferrer">
                Request access →
              </a>
            )
          ) : action?.kind === "link" ? (
            <Link href={action.href} className="btn primary sm mkd-action">
              {action.label}
            </Link>
          ) : (
            /* The same predicate as the catalogue: a listing that is not available offers no
               control, not even a greyed one ("can be listed not requested"). */
            <p className="fp-note">Not open for requests right now.</p>
          )}
        </div>
      </div>

      {comparisonOwnRows.length > 0 && <FeedComparisonScores variant="marketplace" highlight={comparisonOwnRows} />}

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
