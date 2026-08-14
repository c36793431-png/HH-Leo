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

const COMPARE_ROWS = [
  { key: "latency", label: "Feed latency" },
  { key: "redundancy", label: "Path redundancy" },
  { key: "support", label: "Support" },
  { key: "price", label: "Price" },
] as const;

function priceLabel(priceCents: number | null): string {
  return priceCents == null ? "$—/mo" : `$${(priceCents / 100).toFixed(0)}/mo`;
}

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
    existingRequests
      .filter((r) => r.region === region && r.status !== "rejected")
      .map((r) => r.tierKey)
  );
  const licenseTail = licenseDetail?.licenseKey ? `…${licenseDetail.licenseKey.slice(-4)}` : "—";

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
        {tiers.map((t) => (
          <div key={t.tierKey} className={`card ftd-tier-card${t.isFlagship ? " ftd-flagship" : ""}`}>
            {t.isFlagship && <span className="ftd-flagship-badge">FLAGSHIP</span>}
            <span className="ftd-subtitle">{t.subtitle}</span>
            <h3 className="ftd-name">{t.name}</h3>
            <div className="ftd-speed">
              <span className="ftd-speed-value">{t.speedDisplay}</span>
              {t.latencyUs != null && <span className="ftd-speed-unit">µs</span>}
            </div>
            <p className="ftd-desc">{t.description}</p>
            <span className="ftd-price">{priceLabel(t.priceCents)}</span>
            <TierRequestControl
              region={region}
              tierKey={t.tierKey}
              tierName={t.name}
              alreadyRequested={requestedTierKeys.has(t.tierKey)}
              serverName={serverRegistration?.serverName ?? null}
              serverIp={serverRegistration?.declaredIp ?? null}
              licenseTail={licenseTail}
            />
          </div>
        ))}
      </div>

      <div className="ftd-compare card full">
        <h3 className="fp-section-title">Horizon Feed Comparison</h3>
        <table className="ref-table">
          <thead>
            <tr>
              <th>Attribute</th>
              {tiers.map((t) => (
                <th key={t.tierKey}>{t.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                {tiers.map((t) => (
                  <td key={t.tierKey}>
                    {row.key === "latency" && (t.latencyUs != null ? `${t.speedDisplay}µs` : t.speedDisplay)}
                    {row.key === "redundancy" && t.pathRedundancy}
                    {row.key === "support" && t.supportLevel}
                    {row.key === "price" && priceLabel(t.priceCents)}
                  </td>
                ))}
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
