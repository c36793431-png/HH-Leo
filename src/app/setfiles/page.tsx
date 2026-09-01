import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isPaidUser, getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getPortalConfig } from "@/lib/portal-config";
import { PortalShell } from "@/components/portal/portal-shell";
import { LockedLanding } from "@/components/portal/locked-landing";
import { CopySetfileButton } from "@/components/portal/copy-setfile-button";
import { listActiveSetfiles, type SetfileRow, type StrategyKey } from "@/lib/setfiles";

const STRATEGY_GROUP_LABELS: Record<StrategyKey, string> = {
  "1leg": "1-Leg",
  "2leg_lock": "2-Leg Lock",
  trend_impulse: "Trend Impulse",
  obi: "OBI",
  grid: "Grid",
};

const STRATEGY_ORDER: StrategyKey[] = ["1leg", "2leg_lock", "trend_impulse", "obi", "grid"];

function groupSetfiles(rows: SetfileRow[]): { key: StrategyKey; label: string; rows: SetfileRow[] }[] {
  return STRATEGY_ORDER.map((key) => ({
    key,
    label: STRATEGY_GROUP_LABELS[key],
    rows: rows.filter((r) => r.strategyKey === key),
  })).filter((group) => group.rows.length > 0);
}

export default async function SetfilesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const switchablePanels = getReachablePanels(session.user.roles);

  const [paid, activeLicenses, config, setfiles] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getActiveLicenseDetailsForUser(session.user.id).catch(() => []),
    getPortalConfig(),
    listActiveSetfiles().catch(() => []),
  ]);
  const isAdmin = isAdminUser(session.user);
  const unlocked = paid || isAdmin;

  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";
  const groups = groupSetfiles(setfiles);

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      <div className="grid">
        <div className="card full">
          <div className="chead">
            <span className="ic">⚙</span>
            <h3>Setfiles</h3>
          </div>
          {unlocked ? (
            <>
              <div className="lesson-block warning" style={{ marginBottom: 20 }}>
                <div className="lb-head">
                  <span className="lb-tag">⚠ Disclaimer</span>
                </div>
                <p>
                  <b>These are example configurations</b> — starting points from our own testing across
                  common broker/symbol conditions. Trading involves risk; past performance is not
                  indicative of future results. <b>Test any strategy on a demo account first</b>, and start
                  with small lot sizes when going live. Broker execution, spreads, and market conditions
                  vary — expect to tune parameters for your specific setup.
                </p>
                <p style={{ marginTop: 8 }}>
                  Want help tuning for your broker? Message @coxwell2 or the paid Horizon Traders group — we
                  work with each trader individually to dial in their setup.
                </p>
              </div>

              {groups.length === 0 && (
                <p style={{ color: "var(--hz-ink-3)", fontSize: 13 }}>No setfiles published yet — check back soon.</p>
              )}

              {groups.map((group) => (
                <div key={group.key} style={{ marginBottom: 24 }}>
                  <h4 style={{ fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--hz-ink-3)", marginBottom: 10 }}>
                    {group.label}
                  </h4>
                  <div className="grid" style={{ gap: 14 }}>
                    {group.rows.map((row) => (
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
                        <span style={{ fontSize: 12, color: "var(--hz-ink-3)" }}>{row.subtitle}</span>
                        {row.explanation && (
                          <p style={{ fontSize: 13, color: "var(--hz-ink-2)", marginTop: 10, lineHeight: 1.55 }}>{row.explanation}</p>
                        )}
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
                        {row.warnings && (
                          <div className="lesson-block warning" style={{ marginTop: 10 }}>
                            <p>{row.warnings}</p>
                          </div>
                        )}
                        <div style={{ marginTop: 12 }}>
                          <CopySetfileButton params={row.params} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <LockedLanding
              feature="Setfiles"
              tease="Real starting-point configs for our 5 core strategies, tuned across common broker/symbol conditions."
              telegramChannelUrl={config.telegramChannelUrl}
            />
          )}
        </div>
      </div>
    </PortalShell>
  );
}
