import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { isPaidUser, getLicenseForUser, computePortalTier } from "@/lib/licenses";
import { getPortalConfig } from "@/lib/portal-config";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { listActiveSetfiles, type SetfileRow, type StrategyKey } from "@/lib/setfiles";
import { CopySetfileButton } from "@/components/portal/copy-setfile-button";
import { LockedLanding } from "@/components/portal/locked-landing";
import {
  STRATEGY_ORDER,
  STRATEGY_DISPLAY_META,
  computeStrategyCardStatus,
  strategyColoCode,
} from "@/lib/strategy-catalogue";
import { FEED_CATALOGUE } from "@/lib/feeds-catalogue";

function isStrategyKey(value: string): value is StrategyKey {
  return (STRATEGY_ORDER as string[]).includes(value);
}

export default async function StrategyDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isStrategyKey(slug)) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (isAdminUser(session.user)) redirect("/admin/dashboard");

  const [paid, licenseDetail, config, setfiles] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getLicenseForUser(session.user.id).catch(() => null),
    getPortalConfig(),
    listActiveSetfiles().catch(() => []),
  ]);
  const isAdmin = isAdminUser(session.user);
  const tier = computePortalTier(isAdmin, licenseDetail);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";
  const status = computeStrategyCardStatus({ paid, licenseTier: licenseDetail?.tier ?? null, isAdmin });

  const meta = STRATEGY_DISPLAY_META[slug];
  const variants: SetfileRow[] = setfiles.filter((r) => r.strategyKey === slug);
  const primary = variants.find((r) => r.source === "verified") ?? variants[0] ?? null;
  const recommendedFeed = FEED_CATALOGUE.find((f) => f.slug === meta.recommendedFeedSlug) ?? null;

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
      <div className="comm-head">
        <Link href="/strategies" className="btn ghost sm" style={{ marginBottom: 12, display: "inline-block" }}>
          ← All strategies
        </Link>
        <h1>
          <span className="fp-colo fp-colo-inline">{strategyColoCode(meta)}</span> {meta.name}
        </h1>
        <p>{meta.hook}</p>
      </div>

      {status === "locked" ? (
        <div className="grid">
          <div className="card full">
            <LockedLanding
              feature={meta.name}
              tease={meta.hook}
              telegramChannelUrl={config.telegramChannelUrl}
            />
          </div>
        </div>
      ) : (
        <div className="grid">
          <div className="card full">
            <div className="chead">
              <span className="ic">◈</span>
              <h3>Overview</h3>
            </div>
            <p style={{ fontSize: 13, color: "var(--hz-ink-2)", lineHeight: 1.6 }}>
              {primary?.explanation || "Full description coming soon."}
            </p>

            <div className="grid" style={{ marginTop: 16, gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <div>
                <b style={{ display: "block", fontSize: 12, color: "var(--hz-ink-3)", marginBottom: 4 }}>Market focus</b>
                <span style={{ fontSize: 13 }}>{meta.marketFocus}</span>
              </div>
              <div>
                <b style={{ display: "block", fontSize: 12, color: "var(--hz-ink-3)", marginBottom: 4 }}>Execution window</b>
                <span style={{ fontSize: 13 }}>{primary?.sessionWindow ?? "Not specified"}</span>
              </div>
              {recommendedFeed && (
                <div>
                  <b style={{ display: "block", fontSize: 12, color: "var(--hz-ink-3)", marginBottom: 4 }}>Recommended feed</b>
                  <Link href="/feeds" style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span
                      className={`fi fi-${recommendedFeed.countryCode.toLowerCase()}`}
                      role="img"
                      aria-label={`${recommendedFeed.countryCode} flag`}
                      style={{ display: "inline-block", width: 16, height: 12, borderRadius: 2, backgroundSize: "cover", backgroundPosition: "center" }}
                    />
                    {recommendedFeed.name} →
                  </Link>
                </div>
              )}
            </div>

            {primary?.warnings && (
              <div className="lesson-block warning" style={{ marginTop: 16 }}>
                <div className="lb-head">
                  <span className="lb-tag">⚠ Interdependencies & warnings</span>
                </div>
                <p>{primary.warnings}</p>
              </div>
            )}
          </div>

          <div className="card full">
            <div className="chead">
              <span className="ic">⚙</span>
              <h3>Every setting, explained</h3>
            </div>
            <p style={{ fontSize: 12, color: "var(--hz-ink-3)", marginBottom: 12 }}>
              Structured setting-level metadata (recommended ranges, per-field flags) is a follow-up once a
              description column lands on the setfile settings — for now, each field is documented inline below.
            </p>

            {variants.length === 0 && (
              <p style={{ color: "var(--hz-ink-3)", fontSize: 13 }}>No setfiles published for this strategy yet.</p>
            )}

            <div className="grid" style={{ gap: 14 }}>
              {variants.map((row) => (
                <div key={row.id} className="card" style={{ border: "1px solid var(--hz-card-line)" }}>
                  <div className="chead">
                    <span
                      className="lb-tag"
                      style={
                        row.source === "verified"
                          ? { color: "var(--emerald)", background: "var(--emerald-soft)" }
                          : { color: "var(--hz-cyan)", background: "rgba(45, 226, 230, 0.12)" }
                      }
                    >
                      {row.source === "verified" ? "Verified" : "Example"}
                    </span>
                    {row.sessionWindow && <span className="lb-tag">{row.sessionWindow}</span>}
                  </div>
                  <b style={{ display: "block", fontSize: 15, marginBottom: 2 }}>{row.name}</b>
                  {row.params && (
                    <pre
                      style={{
                        fontSize: 12,
                        color: "var(--hz-ink-2)",
                        marginTop: 10,
                        whiteSpace: "pre-wrap",
                        fontFamily: "var(--hz-mono)",
                      }}
                    >
                      {row.params}
                    </pre>
                  )}
                  <div style={{ marginTop: 12 }}>
                    <CopySetfileButton params={row.params} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
