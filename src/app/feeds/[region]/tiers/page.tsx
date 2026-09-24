import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isPaidUser, getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { isFeedRegion, PACKAGE_DISPLAY_LABELS } from "@/lib/feed-tier-catalogue";
import { getTiersForRegion, getMultiTierRegions } from "@/lib/feed-tiers";
import { isScoreRegion, formatTierLatency, tierFigureHeading } from "@/lib/feed-provider-packages";
import {
  tierAvailability,
  MARKETPLACE_AVAILABILITY_LABELS,
  type MarketplaceAvailability,
} from "@/lib/marketplace-catalogue";
import { FEED_CATALOGUE } from "@/lib/feeds-catalogue";
import { TierRequestControl, type TierRequestState } from "@/components/feeds/tier-request-control";
import { getAnyServerRegistrationForUser } from "@/lib/server-registration";
import { getTierRequestContext } from "@/lib/tier-request-context";
import { ServerRegistrationBand } from "@/components/feeds/server-registration-band";
import { FeedComparisonScores } from "@/components/feeds/feed-comparison-scores";
import { scoreForTierKey } from "@/lib/feed-comparison-scores";
import { SectionPills } from "@/components/shared/section-pills";
import type { FeedTierDetail } from "@/lib/feed-tiers";

/** The latency row's label is NOT this literal on a score region — it comes from
 * tierFigureHeading (feed-provider-packages.ts), because for London the cell holds FOC13's
 * comparison score and "Feed latency" over a score reverses which feed reads as best (marcus,
 * m50770). The literal here is the non-score fallback, and is what NY and every µs region
 * renders. */
const COMPARE_ROWS = [
  { key: "latency", label: "Feed latency" },
  { key: "redundancy", label: "Path redundancy" },
  { key: "support", label: "Support" },
] as const;

/** Ranking is FOC13's Feed Comparison Scores leaderboard (feed-comparison-scores.ts),
 * authoritative per marcus (leo-london-tier-page-overhaul-2026-08-17). Promoted from a
 * secondary badge to the actual card sort key per coxwell/marcus greenlight
 * (leo-tiers-page-request-access-rank-order-2026-08-21) -- cards render #1 -> #6, London
 * only. Kept as a JS constant rather than a DB column since London-only ranking with no
 * per-region variance doesn't warrant a migration. */
const LONDON_TIER_RANK: Record<string, number> = {
  "ld-alpha-85": 2,
  "ld-beta-56": 4,
  "ld-gamma-19": 5,
  "ld-delta-18": 6,
  "ld-ultra": 3,
};
const BLACK_RANK = 1;

/** London's card/ref-table SCORE slot reads FEED_COMPARISON_SCORES exclusively (marcus,
 * leo-london-tier-score-mismatch-2026-09-07): feed_tiers.speed_display/latency_us for
 * London rows hold FOC13's comparison score, not real microseconds (b2702d2), and the
 * two disagreed once already for Ultra. scoreForTierKey (feed-comparison-scores.ts) keys
 * by tier_key rather than feed_tiers.name -- 0074 short-formed Alpha/Ultra's name to match
 * this list but never touched Beta/Gamma/Delta, which are still "LD Beta 56" etc in the DB. */
function londonScoreDisplay(tierKey: string): string | null {
  const score = scoreForTierKey(tierKey);
  return score != null ? score.toFixed(1) : null;
}

const BLACK_SCORE_DISPLAY = scoreForTierKey("black")?.toFixed(1) ?? "—";

/** Interim v1 packaging: Beta/Gamma/Delta are three feeds from one provider sold as a
 * single bundle at one price, so they render as one card instead of three competing
 * ones (coxwell/marcus, london-tiers-retail-package-card-2026-08-29). Grouping is keyed
 * by tier here, not by provider_id, because the real packages table doesn't exist yet --
 * this breaks the moment one provider has two packages and should be replaced once that
 * table lands. Unmapped tier keys fall back to package-of-one (their own card). */
const TIER_PACKAGE_KEY: Record<string, string> = {
  "ld-beta-56": "retail",
  "ld-gamma-19": "retail",
  "ld-delta-18": "retail",
  "ny-fast": "ny-retail",
  "ny-normal": "ny-retail",
};
/** Buyer-facing package names moved to feed-tier-catalogue.ts (PACKAGE_DISPLAY_LABELS) when
 * /marketplace became a second surface rendering the same bundle name -- one source so a
 * rename cannot land on one surface only (marcus, m50723 #4). Same values, same keys. */
const PACKAGE_LABELS = PACKAGE_DISPLAY_LABELS;

/** The tier_key a package's single Request access button submits under -- see the
 * ld-retail-package comment in feed-tier-catalogue.ts for why this is a pseudo-tier
 * rather than the three real member tier keys. Submit-only: nothing ever READS a request
 * back under this key (see packageCardState). */
const PACKAGE_REQUEST_TIER_KEY: Record<string, string> = {
  retail: "ld-retail-package",
  "ny-retail": "ny-retail-package",
};

/** "mixed" is a package-card-only state: members disagree, so there is no single honest
 * pill and no live button (marcus R2, kai-feed-entitlement-vs-request-visibility-2026-09-13).
 * It is deliberately NOT a TierRequestState -- the control renders three states and takes
 * no fourth; the mixed branch renders instead of the control, not through it. */
type PackageCardState = TierRequestState | "mixed";

/** A package card's state derives from its MEMBER tiers, never from the package pseudo-tier
 * key (marcus R1, same thread). The card used to look its state up under
 * PACKAGE_REQUEST_TIER_KEY, which no row has carried since 0086 phase 2: createFeedTierRequest
 * expands the package key through expandTierKey() and writes one access_requests envelope per
 * MEMBER tier, and listFeedTierRequests maps each envelope back to its member tier_key. So the
 * lookup could only ever miss, and a client holding the whole bundle -- granted or pending --
 * kept being shown a live "Request access" button that DuplicateTierGrantError /
 * DuplicatePendingRequestError would reject on submit.
 *
 * Mixed (R2) has never occurred in prod: marcus's Neon read 2026-09-13 20:06Z found 12
 * feed_tier batches, 2 multi-member, 0 with a rejection and 0 with mixed member statuses. This
 * branch has to be correct the first time it executes, not pretty. Members are the ones this
 * region actually renders, not expandTierKey()'s full list -- the card can only speak for the
 * tiers on it.
 *
 * expandTierKey()'s list was the alternative and it lost (marcus R3, same thread). The two only
 * differ when a member key has no feed_tiers row, so the region does not render it. Under
 * expandTierKey() the card would read "2 of 3" forever: no envelope can key to a tier with no
 * feed_tiers row, so the third can never resolve and the client has a support ticket with no
 * answer. Under this list the card reads "2 of 2" and a third grant the client holds is
 * invisible. Both are wrong in that state; neither over-claims access; a stuck card is worse
 * than an under-reporting one. Do not "fix" this to expandTierKey() without reading that
 * trade-off first.
 *
 * QUANTIFIER, vs the other package rollup: feed-providers.ts:112 rolls a package up with
 * .some() and this rolls it up with every(). Deliberately opposite, deliberately NOT one
 * shared helper. :112 asks "is there live money here" -- a provider who owns ONE member of a
 * bundle must see and be paid for that request, so any overlap qualifies. This asks "does this
 * client hold what the card promises" -- the card sells three feeds as one bundle, so anything
 * short of all three must not render as granted. Generalising them would make one of the two
 * wrong. Change one, read the other (marcus, same thread). */
function packageCardState(memberStates: TierRequestState[]): PackageCardState {
  if (memberStates.every((s) => s === "granted")) return "granted";
  if (memberStates.every((s) => s === "pending")) return "pending";
  if (memberStates.every((s) => s === "none")) return "none";
  return "mixed";
}

/** A granted package's end date is its EARLIEST member's: the card sells the bundle whole, so it
 * is only held whole until the first member stops -- the same every() reading as packageCardState.
 * Null when any member has no date, rather than printing a date that some member does not share. */
function packageGrantedUntil(memberDates: (Date | null)[]): Date | null {
  if (memberDates.length === 0 || memberDates.some((d) => d == null)) return null;
  return (memberDates as Date[]).reduce((a, b) => (b < a ? b : a));
}

/** The declared state that must SUPPRESS a card's request control, or null when the card keeps
 * the behaviour it had. Driven from marketplace-catalogue.ts so this page cannot disagree with
 * /marketplace and /feeds about whether a product is on sale — coxwell ruled Alpha and Ultra
 * "coming soon, listed, not requested" (m50788), and a fourth surface spelling that state for
 * itself is how the three drifted in the first place.
 *
 * ANY member blocks the WHOLE card, deliberately, and that matters on a package: the Base card
 * sells three feeds as one bundle at one price, so a bundle containing something not on sale
 * cannot be offered whole. No shipped package is in that state today (all three Base members
 * are available) — this is the same rule as tierFigureHeading's, that a card may only claim
 * what is true of every tier beneath it, and it forecloses the next instance rather than
 * describing the current one.
 *
 * Returns the first blocking state so the pill names it: a maintenance product and a
 * coming-soon one are different promises to a buyer and must not collapse into one word.
 *
 * FAILS CLOSED: anything declared and not "available" blocks, the same predicate as the submit
 * action (feeds/actions.ts). This used to list the blocking states by name, so a state added to
 * MarketplaceAvailability put a live request control back on a product not on sale until
 * someone remembered this line (marcus, m52137). null still means "not declared" and leaves the
 * card as it was. */
function blockingAvailability(members: FeedTierDetail[]): MarketplaceAvailability | null {
  for (const m of members) {
    const declared = tierAvailability(m.tierKey);
    if (declared != null && declared !== "available") return declared;
  }
  return null;
}

/** Institutional ($10k+) vs retail segment split (marcus/coxwell,
 * leo-tiers-institutional-retail-labels-2026-08-21). feed_tiers has no price_cents
 * populated yet, so this is a tier-key allowlist rather than a price/enum threshold --
 * swap for a market_segment column once pricing lands in the DB. Alpha promoted into
 * this set as #2 on the Feed Comparison score, bracketing top-3 as Institutional rather
 * than just top-1 + flagship (coxwell, same thread, follow-up). */
const INSTITUTIONAL_TIER_KEYS = new Set(["black", "ld-alpha-85", "ld-ultra"]);

/** Black isn't in feed-tier-catalogue.ts / feed_tiers -- it's a separate paid-only,
 * one-per-client gate (black-trials.ts, 9bbd5a3) with its own request flow on
 * /account/servers. This card is display-only here; its CTA hands off to that page
 * rather than duplicating the gated request logic. coxwell ruled 2026-09-10 that "Coming
 * Soon" (the old join-a-waitlist CTA, back when Black wasn't requestable yet) comes off now
 * that trials are live -- destination is "Request access" -> /account/servers. */
const BLACK_TIER: FeedTierDetail = {
  regionKey: "london",
  tierKey: "black",
  name: "Black",
  subtitle: "FLAGSHIP",
  speedDisplay: BLACK_SCORE_DISPLAY,
  latencyUs: null,
  description:
    "Our fastest institutional feed -- exchange-native, co-located, and #1 on the Horizon Feed Comparison.",
  priceCents: null,
  isFlagship: true,
  pathRedundancy: "Full (LD4)",
  supportLevel: "White-glove (dedicated)",
};

export default async function FeedTiersPage({ params }: { params: Promise<{ region: string }> }) {
  const { region } = await params;
  if (!isFeedRegion(region)) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const switchablePanels = getReachablePanels(session.user.roles);
  if (isAdminUser(session.user)) redirect("/admin/dashboard");

  const [tiers, otherRegions, activeLicenses] = await Promise.all([
    getTiersForRegion(region),
    getMultiTierRegions(),
    getActiveLicenseDetailsForUser(session.user.id).catch(() => []),
  ]);
  if (tiers.length < 2) notFound();

  // One heading for every figure this page renders through formatTierLatency, from the same lib
  // as the figure itself (marcus, m50770). Every tier on the page is this region's, and the
  // Black column only renders for london, so one region key answers for the whole page.
  const figureHeading = tierFigureHeading([region]);

  await isPaidUser(session.user.id).catch(() => false);
  const isAdmin = isAdminUser(session.user);
  // Aggregated across active licenses, same as every other portal page's sidebar badge
  // (thread multi-license-visibility-2026-08-31, marcus) — this page was still keyed off
  // the single latest-issued license.
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  // Server options, per-tier request state and the licence tail come from the shared helper
  // (lib/tier-request-context.ts), which /marketplace/[key] also renders from. The R6 and
  // multi-licence rulings live there now.
  const [serverRegistration, { serverOptions, hasAnyRegisteredServer, requestStateFor, grantedUntilFor, licenseTail }] =
    await Promise.all([
      getAnyServerRegistrationForUser(session.user.id),
      getTierRequestContext(session.user.id, activeLicenses, region),
    ]);

  const displayTiers =
    region === "london"
      ? [...tiers].sort((a, b) => (LONDON_TIER_RANK[a.tierKey] ?? 99) - (LONDON_TIER_RANK[b.tierKey] ?? 99))
      : tiers;

  // Group tiers into packages (see TIER_PACKAGE_KEY above). A group with one member
  // renders identically to a standalone tier card; only multi-member groups (Base)
  // get package treatment. Sorted by each group's best (lowest-number) member rank.
  const tierGroups = (() => {
    const groups = new Map<string, { packageKey: string; rank: number; members: FeedTierDetail[] }>();
    for (const t of displayTiers) {
      const packageKey = TIER_PACKAGE_KEY[t.tierKey] ?? t.tierKey;
      const rank = LONDON_TIER_RANK[t.tierKey] ?? 99;
      const existing = groups.get(packageKey);
      if (existing) {
        existing.members.push(t);
        existing.rank = Math.min(existing.rank, rank);
      } else {
        groups.set(packageKey, { packageKey, rank, members: [t] });
      }
    }
    return [...groups.values()].sort((a, b) => a.rank - b.rank);
  })();

  const catalogueEntry = FEED_CATALOGUE.find((f) => f.slug === region) ?? null;
  const regionName = catalogueEntry?.name ?? region;
  const countryCode = catalogueEntry?.countryCode ?? "";

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      <div className="comm-head">
        <Link href="/feeds" className="btn ghost sm" style={{ marginBottom: 12, display: "inline-block" }}>
          ← All feeds
        </Link>
        <h1>
          {countryCode && (
            <span
              className={`fp-flag fi fi-${countryCode.toLowerCase()}`}
              role="img"
              aria-label={`${countryCode} flag`}
              style={{ display: "inline-block", verticalAlign: "middle", marginRight: 10 }}
            />
          )}
          {regionName} — speed tiers
        </h1>
        <p>
          {tiers.length} tiers · {catalogueEntry?.description ?? "Pick the tier that matches your latency budget."}
        </p>
      </div>

      <SectionPills
        sections={[
          { id: "tiers", label: `${regionName} Feeds` },
          { id: "comparison", label: "Compare" },
        ]}
      />

      {serverRegistration ? (
        <ServerRegistrationBand registration={serverRegistration} />
      ) : (
        <div className="ftd-server-banner no-server">
          <span className="lbl" role="img" aria-label="Server">🖥</span>
          <span className="val">No server registered yet</span>
          <Link href="/account/servers" className="change-link">
            Register a server →
          </Link>
        </div>
      )}

      <div id="tiers" className="ftd-tier-row">
        {region === "london" && (
          <div className="card ftd-tier-card ftd-flagship ftd-black ftd-institutional">
            <span className="ftd-rank-badge ftd-rank-black">#{BLACK_RANK}</span>
            <span className="ftd-flagship-badge ftd-badge-amber">INSTITUTIONAL LATENCY</span>
            <h3 className="ftd-name ftd-name-black">{BLACK_TIER.name}</h3>
            <div className="ftd-speed">
              <span className="ftd-speed-label">SCORE</span>
              <span className="ftd-speed-value">{BLACK_TIER.speedDisplay}</span>
              <span className="ftd-speed-unit">/100</span>
            </div>
            <p className="ftd-desc">{BLACK_TIER.description}</p>
            <div className="ftd-black-ctas">
              <Link href="/account/servers" className="btn amber sm ftd-unlock">
                Request access
              </Link>
            </div>
          </div>
        )}

        {tierGroups.map((group) => {
          if (group.members.length > 1) {
            const label = PACKAGE_LABELS[group.packageKey] ?? group.packageKey;
            const memberStates = group.members.map((m) => requestStateFor(m.tierKey));
            const cardState = packageCardState(memberStates);
            const cardGrantedUntil = packageGrantedUntil(group.members.map((m) => grantedUntilFor(m.tierKey)));
            const blocked = blockingAvailability(group.members);
            return (
              <div
                key={group.packageKey}
                className={`card ftd-tier-card ftd-package${blocked ? " ftd-unavailable" : ""}`}
              >
                {region === "london" && (
                  <>
                    <span className="ftd-rank-badge">#{group.rank}</span>
                    <span className="ftd-segment-badge">RETAIL LATENCY</span>
                  </>
                )}
                <h3 className="ftd-name">{label}</h3>
                <p className="ftd-desc">
                  {group.members.length} feeds from one provider, sold as a single bundle at one price.
                </p>
                {/* The per-member figures below carried no heading of their own, directly under a
                    RETAIL LATENCY segment badge — the same three London scores that /marketplace
                    was reading as latencies (marcus, m50770). The badge names the market segment,
                    not the number; this names the number. */}
                {figureHeading && (
                  <span className="ftd-pkg-members-label">
                    {figureHeading.label}
                    {figureHeading.note && (
                      <span className="figure-direction-note">{` · ${figureHeading.note}`}</span>
                    )}
                  </span>
                )}
                <div className="ftd-pkg-members">
                  {group.members.map((m) => {
                    const londonScore = region === "london" ? londonScoreDisplay(m.tierKey) : null;
                    return (
                      <div key={m.tierKey} className="ftd-pkg-member">
                        <div className="ftd-pkg-member-row">
                          <span className="ftd-pkg-member-name">{m.name}</span>
                          <span className="ftd-pkg-member-score">
                            {londonScore ?? m.speedDisplay}
                            {/* The unit is only printed when there IS a figure of that kind.
                                NY's members have a null latency_us, so speedDisplay is a bare
                                "—" and this printed "—µs" — a unit asserting a kind the value
                                does not have, the quiet form of the m50770 defect, and a second
                                spelling of the unknown the comparison row already writes as a
                                bare "—". Take the bare "—": it claims nothing, which is what we
                                want where we have nothing (marcus, m50802 residue 2). Same
                                guard the single-tier card below already carried. */}
                            {(londonScore != null || m.latencyUs != null) && (
                              <span className="ftd-speed-unit">{isScoreRegion(region) ? "/100" : "µs"}</span>
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {blocked ? (
                  /* Availability outranks request state: a product that is not on sale offers
                     nothing, whatever this client has previously asked for. */
                  <span className={`mkt-pill mkt-pill-${blocked} ftd-availability-pill`}>
                    {MARKETPLACE_AVAILABILITY_LABELS[blocked]}
                  </span>
                ) : cardState === "mixed" ? (
                  /* No button, not even a disabled one: the submit path from here throws
                     (access-requests.ts:205 asserts no live grant per member and rolls the whole
                     batch back), and a control that can only throw must not render as actionable
                     -- a greyed button still advertises an action. No pill and no per-member
                     labels either: this is loud-and-stuck on purpose, NOT a designed state, and
                     a real partial pill with a CTA for the remainder is Iris's later (marcus R2
                     AMENDED, kai-feed-entitlement-vs-request-visibility-2026-09-13).
                     The wording does NOT say "partly approved": "mixed" is any disagreement,
                     including pending + none with nothing approved at all, so an approval claim
                     would be false on that shape. "different stages" is true on every shape. */
                  <p className="ftd-desc">
                    Tiers in this bundle are at different stages, so it cannot be requested as one.
                  </p>
                ) : (
                  <TierRequestControl
                    region={region}
                    tierKey={PACKAGE_REQUEST_TIER_KEY[group.packageKey] ?? group.packageKey}
                    tierName={`${label} package`}
                    requestState={cardState}
                    grantedUntil={cardGrantedUntil?.toLocaleDateString() ?? null}
                    servers={serverOptions}
                    hasAnyRegisteredServer={hasAnyRegisteredServer}
                    fallbackLicenseTail={licenseTail}
                    variant="primary"
                  />
                )}
              </div>
            );
          }

          const t = group.members[0];
          const isInstitutional = region === "london" && INSTITUTIONAL_TIER_KEYS.has(t.tierKey);
          const londonScore = region === "london" ? londonScoreDisplay(t.tierKey) : null;
          const blocked = blockingAvailability(group.members);
          return (
          <div
            key={t.tierKey}
            className={`card ftd-tier-card${t.isFlagship ? " ftd-flagship" : ""}${isInstitutional ? " ftd-institutional" : ""}${blocked ? " ftd-unavailable" : ""}`}
          >
            {region === "london" && LONDON_TIER_RANK[t.tierKey] != null && (
              <span className={`ftd-rank-badge${isInstitutional ? " ftd-rank-amber" : ""}`}>
                #{LONDON_TIER_RANK[t.tierKey]}
              </span>
            )}
            {isInstitutional ? (
              t.isFlagship ? (
                <span className="ftd-flagship-badge ftd-badge-amber">{t.subtitle}</span>
              ) : (
                <>
                  <span className="ftd-segment-badge ftd-badge-amber">INSTITUTIONAL LATENCY</span>
                  <span className="ftd-subtitle">{t.subtitle}</span>
                </>
              )
            ) : t.isFlagship ? (
              <span className="ftd-flagship-badge">{t.subtitle}</span>
            ) : region === "london" ? (
              <>
                <span className="ftd-segment-badge">RETAIL LATENCY</span>
                <span className="ftd-subtitle">{t.subtitle}</span>
              </>
            ) : (
              <span className="ftd-subtitle">{t.subtitle}</span>
            )}
            <h3 className="ftd-name">{t.name}</h3>
            <div className="ftd-speed">
              {londonScore != null && <span className="ftd-speed-label">SCORE</span>}
              <span className="ftd-speed-value">{londonScore ?? t.speedDisplay}</span>
              {(londonScore != null || t.latencyUs != null) && (
                <span className="ftd-speed-unit">{isScoreRegion(region) ? "/100" : "µs"}</span>
              )}
            </div>
            <p className="ftd-desc">{t.description}</p>
            {blocked ? (
              /* Alpha and Ultra land here (coxwell via marcus, m50788): the card stays, the
                 action goes. Not a disabled button — "can be listed not requested" means the
                 control is ABSENT, and a greyed button still advertises an action. The pill is
                 /marketplace's own, from the same class and the same label map, so the two
                 surfaces cannot spell one state two ways. */
              <span className={`mkt-pill mkt-pill-${blocked} ftd-availability-pill`}>
                {MARKETPLACE_AVAILABILITY_LABELS[blocked]}
              </span>
            ) : (
              <TierRequestControl
                region={region}
                tierKey={t.tierKey}
                tierName={t.name}
                requestState={requestStateFor(t.tierKey)}
                grantedUntil={grantedUntilFor(t.tierKey)?.toLocaleDateString() ?? null}
                servers={serverOptions}
                hasAnyRegisteredServer={hasAnyRegisteredServer}
                fallbackLicenseTail={licenseTail}
                variant={isInstitutional ? "amber" : "primary"}
              />
            )}
          </div>
          );
        })}
      </div>

      {region === "london" && <FeedComparisonScores />}

      <div id="comparison" className="ftd-compare card full">
        <h3 className="fp-section-title">Horizon Feed Comparison</h3>
        <table className="ref-table">
          <thead>
            <tr>
              <th>Attribute</th>
              {tiers.map((t) => (
                <th key={t.tierKey}>{t.name}</th>
              ))}
              {region === "london" && <th key={BLACK_TIER.tierKey}>{BLACK_TIER.name}</th>}
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map((row) => (
              <tr key={row.key}>
                <td>
                  {row.key === "latency" && figureHeading ? (
                    <>
                      {figureHeading.label}
                      {figureHeading.note && (
                        <span className="figure-direction-note">{` · ${figureHeading.note}`}</span>
                      )}
                    </>
                  ) : (
                    row.label
                  )}
                </td>
                {tiers.map((t) => (
                  <td key={t.tierKey}>
                    {row.key === "latency" && formatTierLatency(region, t)}
                    {row.key === "redundancy" && t.pathRedundancy}
                    {row.key === "support" && t.supportLevel}
                  </td>
                ))}
                {region === "london" && (
                  <td key={BLACK_TIER.tierKey}>
                    {row.key === "latency" && formatTierLatency(BLACK_TIER.regionKey, BLACK_TIER)}
                    {row.key === "redundancy" && BLACK_TIER.pathRedundancy}
                    {row.key === "support" && BLACK_TIER.supportLevel}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="fp-footnote">
        This layout scales to every multi-tier region we run —{" "}
        {otherRegions
          .filter((r) => r !== region)
          .map((r, i, arr) => (
            <span key={r}>
              <Link href={`/feeds/${r}/tiers`}>{FEED_CATALOGUE.find((f) => f.slug === r)?.name ?? r}</Link>
              {i < arr.length - 1 ? ", " : ""}
            </span>
          ))}
        {otherRegions.filter((r) => r !== region).length === 0 && "more regions as they light up."}
      </p>

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
