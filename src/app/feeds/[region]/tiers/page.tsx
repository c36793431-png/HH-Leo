import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { isPaidUser, getLicenseForUser, computePortalTier } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { isFeedRegion } from "@/lib/feed-tier-catalogue";
import { getTiersForRegion, getMultiTierRegions } from "@/lib/feed-tiers";
import { FEED_CATALOGUE } from "@/lib/feeds-catalogue";
import { TierRequestControl } from "@/components/feeds/tier-request-control";
import { getServerRegistration } from "@/lib/server-registration";
import { listFeedTierRequests } from "@/lib/feed-tier-requests";
import { FeedComparisonScores } from "@/components/feeds/feed-comparison-scores";
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

/** Institutional ($10k+) vs retail segment split (marcus/coxwell,
 * leo-tiers-institutional-retail-labels-2026-08-21). feed_tiers has no price_cents
 * populated yet, so this is a tier-key allowlist rather than a price/enum threshold --
 * swap for a market_segment column once pricing lands in the DB. */
const INSTITUTIONAL_TIER_KEYS = new Set(["black", "ld-ultra"]);

/** Black isn't in feed-tier-catalogue.ts / feed_tiers -- it's a separate paid-only,
 * one-per-desk gate (black-trials.ts, 9bbd5a3) with its own request flow on
 * /account/servers. This card is display-only here; both CTAs hand off to that page
 * rather than duplicating the gated request logic. */
const BLACK_TIER: FeedTierDetail = {
  regionKey: "london",
  tierKey: "black",
  name: "Black",
  subtitle: "FLAGSHIP",
  speedDisplay: "MIN",
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
  if (isAdminUser(session.user)) redirect("/admin/dashboard");

  const [tiers, otherRegions, licenseDetail] = await Promise.all([
    getTiersForRegion(region),
    getMultiTierRegions(),
    getLicenseForUser(session.user.id).catch(() => null),
  ]);
  if (tiers.length < 2) notFound();

  await isPaidUser(session.user.id).catch(() => false);
  const isAdmin = isAdminUser(session.user);
  const tier = computePortalTier(isAdmin, licenseDetail);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  const [serverRegistration, existingRequests] = await Promise.all([
    licenseDetail ? getServerRegistration(licenseDetail.id) : Promise.resolve(null),
    listFeedTierRequests({ userId: session.user.id }),
  ]);
  const requestedTierKeys = new Set(
    existingRequests.filter((r) => r.region === region && r.status !== "rejected").map((r) => r.tierKey)
  );
  const licenseTail = licenseDetail?.licenseKey ? licenseDetail.licenseKey.slice(-4) : "—";

  const displayTiers =
    region === "london"
      ? [...tiers].sort((a, b) => (LONDON_TIER_RANK[a.tierKey] ?? 99) - (LONDON_TIER_RANK[b.tierKey] ?? 99))
      : tiers;

  const catalogueEntry = FEED_CATALOGUE.find((f) => f.slug === region) ?? null;
  const regionName = catalogueEntry?.name ?? region;
  const countryCode = catalogueEntry?.countryCode ?? "";

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
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

      {serverRegistration ? (
        <div className="ftd-server-banner">
          <span className="lbl">Server</span>
          <span className="val">{serverRegistration.serverName}</span>
          <span className="val">· {serverRegistration.declaredIp}</span>
          <span className="verified">✓ Verified</span>
          <Link href="/account/servers" className="change-link">
            Change server →
          </Link>
        </div>
      ) : (
        <div className="ftd-server-banner no-server">
          <span className="lbl">Server</span>
          <span className="val">No server registered yet</span>
          <Link href="/account/servers" className="change-link">
            Register a server →
          </Link>
        </div>
      )}

      <div className="ftd-tier-row">
        {region === "london" && (
          <div className="card ftd-tier-card ftd-flagship ftd-black ftd-institutional">
            <span className="ftd-rank-badge ftd-rank-black">#{BLACK_RANK}</span>
            <span className="ftd-flagship-badge ftd-badge-amber">INSTITUTIONAL LATENCY</span>
            <h3 className="ftd-name ftd-name-black">{BLACK_TIER.name}</h3>
            <div className="ftd-speed">
              <span className="ftd-speed-value">{BLACK_TIER.speedDisplay}</span>
            </div>
            <p className="ftd-desc">{BLACK_TIER.description}</p>
            <div className="ftd-black-ctas">
              <Link href="/account/servers" className="btn amber sm">
                Start 7-day trial →
              </Link>
              <Link href="/account/servers" className="btn ghost sm">
                Request access →
              </Link>
            </div>
          </div>
        )}

        {displayTiers.map((t) => {
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
              <span className="ftd-flagship-badge ftd-badge-amber">{t.subtitle}</span>
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
              {t.latencyUs != null &&
                (region === "london" ? (
                  <span className="ftd-speed-unit">/100</span>
                ) : (
                  <span className="ftd-speed-unit">µs</span>
                ))}
            </div>
            <p className="ftd-desc">{t.description}</p>
            <TierRequestControl
              region={region}
              tierKey={t.tierKey}
              tierName={t.name}
              alreadyRequested={requestedTierKeys.has(t.tierKey)}
              serverName={serverRegistration?.serverName ?? null}
              serverIp={serverRegistration?.declaredIp ?? null}
              licenseTail={licenseTail}
              variant={isInstitutional ? "amber" : "primary"}
            />
          </div>
          );
        })}
      </div>

      {region === "london" && <FeedComparisonScores />}

      <div className="ftd-compare card full">
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
