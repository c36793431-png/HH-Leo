import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isPaidUser, getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { isFeedRegion, FEED_REGION_TYPE } from "@/lib/feed-tier-catalogue";
import { getTiersForRegion, getMultiTierRegions } from "@/lib/feed-tiers";
import { isScoreRegion } from "@/lib/feed-provider-packages";
import { FEED_CATALOGUE } from "@/lib/feeds-catalogue";
import { TierRequestControl, type TierRequestServerOption } from "@/components/feeds/tier-request-control";
import { BlackWaitlistControl } from "@/components/feeds/black-waitlist-control";
import { getAnyServerRegistrationForUser, getServerRegistrationsForUser } from "@/lib/server-registration";
import { effectiveServerLocation } from "@/lib/server-locations";
import { ServerRegistrationBand } from "@/components/feeds/server-registration-band";
import { listFeedTierRequests } from "@/lib/feed-tier-requests";
import { hasJoinedTierWaitlist } from "@/lib/tier-waitlist";
import { FeedComparisonScores } from "@/components/feeds/feed-comparison-scores";
import { SectionPills } from "@/components/shared/section-pills";
import type { FeedTierDetail } from "@/lib/feed-tiers";

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
const PACKAGE_LABELS: Record<string, string> = {
  retail: "Base",
  "ny-retail": "Base",
};

/** The tier_key a package's single Request access button submits under -- see the
 * ld-retail-package comment in feed-tier-catalogue.ts for why this is a pseudo-tier
 * rather than the three real member tier keys. */
const PACKAGE_REQUEST_TIER_KEY: Record<string, string> = {
  retail: "ld-retail-package",
  "ny-retail": "ny-retail-package",
};

/** Institutional ($10k+) vs retail segment split (marcus/coxwell,
 * leo-tiers-institutional-retail-labels-2026-08-21). feed_tiers has no price_cents
 * populated yet, so this is a tier-key allowlist rather than a price/enum threshold --
 * swap for a market_segment column once pricing lands in the DB. Alpha promoted into
 * this set as #2 on the Feed Comparison score, bracketing top-3 as Institutional rather
 * than just top-1 + flagship (coxwell, same thread, follow-up). */
const INSTITUTIONAL_TIER_KEYS = new Set(["black", "ld-alpha-85", "ld-ultra"]);

/** Black isn't in feed-tier-catalogue.ts / feed_tiers -- it's a separate paid-only,
 * one-per-desk gate (black-trials.ts, 9bbd5a3) with its own request flow on
 * /account/servers. This card is display-only here; both CTAs hand off to that page
 * rather than duplicating the gated request logic. */
const BLACK_TIER: FeedTierDetail = {
  regionKey: "london",
  tierKey: "black",
  name: "Black",
  subtitle: "FLAGSHIP",
  speedDisplay: "94.8",
  latencyUs: 94.8,
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

  await isPaidUser(session.user.id).catch(() => false);
  const isAdmin = isAdminUser(session.user);
  // Aggregated across active licenses, same as every other portal page's sidebar badge
  // (thread multi-license-visibility-2026-08-31, marcus) — this page was still keyed off
  // the single latest-issued license.
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  const [serverRegistration, userServerRegistrations, existingRequests, blackWaitlisted] = await Promise.all([
    getAnyServerRegistrationForUser(session.user.id),
    getServerRegistrationsForUser(session.user.id),
    listFeedTierRequests({ userId: session.user.id }),
    region === "london" ? hasJoinedTierWaitlist(session.user.id, "london", "black") : Promise.resolve(false),
  ]);
  // Cross-region binding is legitimate (coxwell, leo-cross-region-server-picker-2026-09-04:
  // "yes they can if they wish") -- the request modal picks from every active license the
  // client holds, not just servers registered in the tier's own region. A license with no
  // registration stays listed (Fable's R6 "binding unconfirmed" downstream) -- deliberate,
  // do not filter it out here.
  const registrationByLicenseId = new Map(userServerRegistrations.map((r) => [r.licenseId, r]));
  // Distinct from serverOptions.length === 0 (no active license): this is "active license(s),
  // but not one of them has ever had a server registered" -- R6's "binding unconfirmed" listing
  // only covers a client who has at least one registration elsewhere (marcus,
  // leo-cross-region-server-picker-2026-09-04 ruling). Zero here must still hard-stop.
  const hasAnyRegisteredServer = userServerRegistrations.length > 0;
  const serverOptions: TierRequestServerOption[] = activeLicenses.map((l) => {
    const r = registrationByLicenseId.get(l.id);
    return {
      licenseId: l.id,
      serverName: r?.serverName ?? null,
      declaredIp: r?.declaredIp ?? null,
      region: r ? effectiveServerLocation(r.location, r.serverLocation) : null,
      licenseKeyTail: l.licenseKey.slice(-4),
      registered: !!r,
    };
  });
  const requestedTierKeys = new Set(
    existingRequests.filter((r) => r.region === region && r.status !== "rejected").map((r) => r.tierKey)
  );
  // A license key identifies one specific license, not an aggregate — never blend multiple
  // licenses into one tail. Show this region's active license(s); if the client holds two
  // active licenses that both grant this region, show both rather than picking one
  // (coxwell-approved rule, thread multi-license-visibility-2026-08-31).
  const regionFeedType = FEED_REGION_TYPE[region];
  const regionLicenses = regionFeedType
    ? activeLicenses.filter((l) => l.feedTypes.includes(regionFeedType))
    : [];
  const licenseTail =
    regionLicenses.length > 0 ? regionLicenses.map((l) => l.licenseKey.slice(-4)).join(", ") : "—";

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
              <BlackWaitlistControl
                region="london"
                tierKey="black"
                tierName={BLACK_TIER.name}
                alreadyJoined={blackWaitlisted}
              />
            </div>
          </div>
        )}

        {tierGroups.map((group) => {
          if (group.members.length > 1) {
            const label = PACKAGE_LABELS[group.packageKey] ?? group.packageKey;
            return (
              <div key={group.packageKey} className="card ftd-tier-card ftd-package">
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
                <div className="ftd-pkg-members">
                  {group.members.map((m) => (
                    <div key={m.tierKey} className="ftd-pkg-member">
                      <div className="ftd-pkg-member-row">
                        <span className="ftd-pkg-member-name">{m.name}</span>
                        <span className="ftd-pkg-member-score">
                          {m.speedDisplay}
                          <span className="ftd-speed-unit">{isScoreRegion(region) ? "/100" : "µs"}</span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <TierRequestControl
                  region={region}
                  tierKey={PACKAGE_REQUEST_TIER_KEY[group.packageKey] ?? group.packageKey}
                  tierName={`${label} package`}
                  alreadyRequested={requestedTierKeys.has(PACKAGE_REQUEST_TIER_KEY[group.packageKey] ?? group.packageKey)}
                  servers={serverOptions}
                  hasAnyRegisteredServer={hasAnyRegisteredServer}
                  fallbackLicenseTail={licenseTail}
                  variant="primary"
                />
              </div>
            );
          }

          const t = group.members[0];
          const isInstitutional = region === "london" && INSTITUTIONAL_TIER_KEYS.has(t.tierKey);
          return (
          <div
            key={t.tierKey}
            className={`card ftd-tier-card${t.isFlagship ? " ftd-flagship" : ""}${isInstitutional ? " ftd-institutional" : ""}`}
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
              {region === "london" && t.latencyUs != null && (
                <span className="ftd-speed-label">SCORE</span>
              )}
              <span className="ftd-speed-value">{t.speedDisplay}</span>
              {t.latencyUs != null && (
                <span className="ftd-speed-unit">{isScoreRegion(region) ? "/100" : "µs"}</span>
              )}
            </div>
            <p className="ftd-desc">{t.description}</p>
            <TierRequestControl
              region={region}
              tierKey={t.tierKey}
              tierName={t.name}
              alreadyRequested={requestedTierKeys.has(t.tierKey)}
              servers={serverOptions}
              hasAnyRegisteredServer={hasAnyRegisteredServer}
              fallbackLicenseTail={licenseTail}
              variant={isInstitutional ? "amber" : "primary"}
            />
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
                <td>{row.label}</td>
                {tiers.map((t) => (
                  <td key={t.tierKey}>
                    {row.key === "latency" &&
                      (t.latencyUs != null
                        ? region === "london"
                          ? `${t.speedDisplay}/100 score`
                          : `${t.speedDisplay}µs`
                        : t.speedDisplay)}
                    {row.key === "redundancy" && t.pathRedundancy}
                    {row.key === "support" && t.supportLevel}
                  </td>
                ))}
                {region === "london" && (
                  <td key={BLACK_TIER.tierKey}>
                    {row.key === "latency" && BLACK_TIER.speedDisplay}
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
