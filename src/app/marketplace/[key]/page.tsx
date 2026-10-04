import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses, type FeedType } from "@/lib/licenses";
import { getPortalConfig } from "@/lib/portal-config";
import { computeUnlockedFeedTypes } from "@/lib/feed-subscriptions";
import { computeSignalFeedCards } from "@/lib/signal-feed-cards";
import { TerminalAccessBox } from "@/components/marketplace/terminal-access-box";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { feedTierMeta } from "@/lib/feed-tier-catalogue";
import { getPublicTiersForRegion, getTierCountsByRegion, getBestLatencyByRegion, type PublicFeedTier } from "@/lib/feed-tiers";
import { MARKETPLACE_AVAILABILITY_LABELS, listingByKey, listingDetailHref } from "@/lib/marketplace-catalogue";
import { authPageHref } from "@/lib/post-auth-redirect";
import { PublicShell } from "@/components/marketplace/public-shell";
import { getTierRequestContext } from "@/lib/tier-request-context";
import { TierRequestControl } from "@/components/feeds/tier-request-control";
import { ListingFigures, hasListingFigures, listingFigureMembers } from "@/components/marketplace/listing-figures";
import { ListingMedia } from "@/components/marketplace/listing-media";
import { IncludedSections } from "@/components/marketplace/included-sections";
import { FeedComparisonScores } from "@/components/feeds/feed-comparison-scores";
import { scoreNamesForTierKeys } from "@/lib/feed-comparison-scores";
import { basketEntry } from "@/lib/basket-catalogue";
import { BasketAddBox } from "@/components/marketplace/basket-controls";
import { MemberSuccessStories } from "@/components/marketplace/member-success-stories";

/**
 * /marketplace/[key]: the product page behind every shelf card's "See more →" (coxwell
 * 2026-09-23 via marcus, m52432/m52443, and m52589: "See more should be for all of them").
 * Every listing has one, Not available ones included. An unknown key 404s.
 *
 * THE ACTION IS THE LISTING'S, AND ONLY WHEN IT IS AVAILABLE. A "request" listing renders the
 * shipped TierRequestControl, which goes through submitFeedTierRequestAction to the normal admin
 * queue and the Telegram DM, with the same Requested/Approved states as the tiers page. A "link"
 * listing hands off to the page that owns its flow. A "download" listing (the terminal) renders
 * TerminalAccessBox: a licensed account gets its licence, its feeds and the link (m53069), and
 * everyone else "Request access →" to Telegram (m53009 (a)).
 * A listing that is not available offers nothing, even if the catalogue gave it an action by
 * mistake.
 *
 * PUBLIC SINCE 2026-09-28 (coxwell via marcus, m55542/m55551): a signed-out visitor sees the
 * product and, in place of any action, "Sign in to request →", which returns them here.
 *
 * REQUEST, NOT BUY, AND NO PRICE. coxwell ruled no checkout, and prices are agreed over
 * Telegram (m52454 (a)).
 *
 * THE SPEC PLATE IS CHICAGO'S AND NOBODY ELSE'S. Coverage is the listing's own `coverage` line,
 * not the row's `description`: that one (marcus's INSERT off provider_tiers dff16179, m52454)
 * names the upstream vendor's dataset code, which no public page shows (marcus m56642 (b)). There
 * is no Delivery row. `subtitle` names the delivery protocol, which the public page does not
 * (coxwell via marcus, m55723). Both stay unedited on the row because the provider's own dashboard
 * renders them.
 * The London and NY rows' subtitle and description carry latency claims ("Minimum achievable
 * latency", "fastest fixed-latency") that no buyer surface added since may repeat, and the London
 * subtitles contradict the comparison scores. So the plate renders only for a listing with a
 * `coverage` line, and every other feed page shows its comparison figures from the same block as
 * its shelf card. Host and port are fulfilment detail and never reach this page.
 *
 * LAYOUT follows Iris's 09-18 product-available.html (m52499–m52503): an identity block, then
 * the product on the left and the Access box on the right. The hero image (with its flag or
 * plate) and What's included come from her 2026-09-23 delivery through the catalogue (m52632),
 * and each renders only when the listing carries it. A What's included with laid-out sections
 * (the terminal's strategy cards and features grid, m58579 (a)) goes full width below both instead.
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
  // No account is a public visitor now, not a redirect to /login. A visitor gets every read below
  // that is about the product and none that is about an account: those need a user id to run.
  const user = session?.user?.id ? session.user : null;
  if (user && isAdminUser(user)) redirect("/admin/dashboard");

  const isAdmin = user ? isAdminUser(user) : false;
  const activeLicenses = user ? await getActiveLicenseDetailsForUser(user.id).catch(() => []) : [];

  // The shipped WHERE and ORDER, as /marketplace reads them, once per region the listing's tiers
  // live in, without price_cents (see /marketplace). A tier-backed listing whose rows have all
  // gone 404s, the same way its card leaves the shelf.
  const regions = [...new Set(listing.tierKeys.flatMap((k) => feedTierMeta(k)?.region ?? []))];
  const rows = (await Promise.all(regions.map((r) => getPublicTiersForRegion(r).catch(() => [])))).flat();
  const members = listing.tierKeys
    .map((k) => rows.find((t) => t.tierKey === k))
    .filter((t): t is PublicFeedTier => t != null);
  if (listing.tierKeys.length > 0 && members.length === 0) notFound();

  const action = listing.availability === "available" ? listing.action : null;

  // A request control submits one tier_key. A "request" listing not backed by exactly one row
  // 404s rather than rendering a button that submits the wrong thing, or nothing.
  let request: { row: PublicFeedTier; tierName: string; region: PublicFeedTier["regionKey"] } | null = null;
  if (action?.kind === "request") {
    const tierMeta = listing.tierKeys.length === 1 ? feedTierMeta(listing.tierKeys[0]) : null;
    if (!tierMeta || members.length !== 1) notFound();
    request = { row: members[0], tierName: tierMeta.name, region: tierMeta.region };
  }
  const requestContext = request && user
    ? await getTierRequestContext(user.id, activeLicenses, request.region)
    : null;

  // A "download" listing: licensed means activeLicenses is non-empty, the read above, which is
  // /dashboard's licence card read and isPaidUser's predicate (m53069). A failed read is [] and
  // fails closed to Request access, never to Downloads. The feed cards are /dashboard's, from the
  // same readers, and are only read for a licensed account.
  const licensed = activeLicenses.length > 0;
  const download =
    action?.kind === "download" && user
      ? await Promise.all([
          getPortalConfig(),
          licensed ? computeUnlockedFeedTypes(user.id).catch((): FeedType[] => []) : [],
          licensed ? getTierCountsByRegion().catch(() => ({}) as Awaited<ReturnType<typeof getTierCountsByRegion>>) : {},
          licensed ? getBestLatencyByRegion().catch(() => ({}) as Awaited<ReturnType<typeof getBestLatencyByRegion>>) : {},
        ]).then(([config, activeFeeds, feedTierCounts, feedBestLatency]) => ({
          requestHref: config.telegramChannelUrl,
          feeds: licensed
            ? computeSignalFeedCards({ activeFeeds, activeLicenses, isAdmin, feedTierCounts, feedBestLatency })
            : [],
        }))
      : null;

  const basket = basketEntry(listing.category === "feeds" ? "feed" : "software", listing.key);
  const figures = listingFigureMembers(listing, members);
  const included = listing.included ?? [];
  // A laid-out list (the terminal's, m58579 (a)) needs the page's width, so it leaves the left
  // column for a block of its own below the Access box. Every other list stays where it was.
  const includedWide = included.some((entry) => typeof entry !== "string" && entry.layout);
  const comparisonOwnRows = scoreNamesForTierKeys(
    listing.scoreTierKey ? [...listing.tierKeys, listing.scoreTierKey] : listing.tierKeys,
  );
  // With no image, spec, figures or included list, the left column is empty and the Access box
  // would float alone at the far right. It takes the left edge instead. No listing hits this since
  // every one carries an image; it guards the next listing added without one.
  const leftEmpty =
    !listing.image && !listing.coverage && !hasListingFigures(figures) && (included.length === 0 || includedWide);
  // Signing in returns the visitor to this product page, where the real control is.
  const signInHref = authPageHref("/login", listingDetailHref(listing));

  const page = (
    <>
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

            {listing.coverage ? (
              <div className="card">
                <div className="mkd-plate-title">Specification</div>
                <dl className="mkd-spec">
                  <dt>Coverage</dt>
                  <dd>{listing.coverage}</dd>
                </dl>
              </div>
            ) : (
              hasListingFigures(figures) && (
                <div className="card mkd-figures">
                  <ListingFigures members={figures} />
                </div>
              )
            )}

            {included.length > 0 && !includedWide && (
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

        <div className="mkd-side">
        <div id="request" className="card mkd-request">
          <div className="mkd-plate-title">Access</div>
          {!user && action ? (
            /* Requesting needs an account (coxwell via marcus, m55542): one control for every
               available listing, whatever its signed-in action is. A listing with no action falls
               through to "Not open for requests right now.", the same as signed in. */
            <Link href={signInHref} className="btn primary sm mkd-action">
              Sign in to request →
            </Link>
          ) : request && requestContext ? (
            <>
              <TierRequestControl
                region={request.region}
                tierKey={request.row.tierKey}
                tierName={request.tierName}
                requestState={requestContext.requestStateFor(request.row.tierKey)}
                grantedUntil={requestContext.grantedUntilFor(request.row.tierKey)?.toLocaleDateString() ?? null}
                servers={requestContext.serverOptions}
                hasAnyRegisteredServer={requestContext.hasAnyRegisteredServer}
                fallbackLicenseTail={requestContext.licenseTail}
              />
              <p className="fp-note">
                Access is granted to one registered server. Its IP is allowlisted once your request is approved.
              </p>
            </>
          ) : action?.kind === "download" && download ? (
            <TerminalAccessBox
              licenses={activeLicenses}
              feeds={download.feeds}
              download={{ href: action.href, label: action.label }}
              requestHref={download.requestHref}
            />
          ) : action?.kind === "link" ? (
            <Link href={action.href} className="btn primary sm mkd-action">
              {action.label}
            </Link>
          ) : (
            /* The same predicate as the catalogue: a listing that is not available offers no
               control, not even a greyed one ("can be listed not requested"). */
            <p className="fp-note">Not open for requests right now.</p>
          )}
          {/* Under whatever the request control is, in every state (signed out, unlicensed,
              licensed): secondary, so the request stays primary (marcus m59190). */}
          {listing.moreInfo && (
            <a href={listing.moreInfo.href} className="btn ghost sm mkd-action">
              {listing.moreInfo.label}
            </a>
          )}
        </div>
        {/* The request basket (Iris sheet 2, marcus m59146), under the Access box rather than in
            its place: the listing's own request stays the tracked path. Only a listing the basket
            can carry gets it, so Black, Alpha and Ultra show none. Signed out too: a visitor adds
            here and signs in at send. */}
        {basket && <BasketAddBox kind={basket.kind} keyName={basket.key} name={basket.name} chips={basket.chips} />}
        </div>
      </div>

      {includedWide && <IncludedSections included={included} />}

      {comparisonOwnRows.length > 0 && <FeedComparisonScores variant="marketplace" highlight={comparisonOwnRows} />}

      {/* The old main site's feedback carousel, at the END of the page after What's included
          (coxwell via marcus, m59186; the m58607 hold is lifted by his ask, m59209). The terminal
          has no comparison board, so nothing sits between the two. */}
      {listing.memberStories && <MemberSuccessStories />}

      <div className="foot">HORIZON HFT · customer portal</div>
    </>
  );

  if (!user) return <PublicShell signInHref={signInHref}>{page}</PublicShell>;

  const switchablePanels = getReachablePanels(user.roles);
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const userName = user.name ?? user.email ?? "trader";
  const userEmail = user.email ?? "";

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      {page}
    </PortalShell>
  );
}
