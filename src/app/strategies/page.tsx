import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import {
  isPaidUser,
  getActiveLicenseDetailsForUser,
  computePortalTierFromLicenses,
} from "@/lib/licenses";
import { getPortalConfig } from "@/lib/portal-config";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { listActiveSetfiles, type SetfileRow, type StrategyKey } from "@/lib/setfiles";
import {
  STRATEGY_ORDER,
  STRATEGY_DISPLAY_META,
  computeStrategyCardStatus,
  strategyColoCode,
  type StrategyCardStatus,
} from "@/lib/strategy-catalogue";
import { StrategyRequestForm } from "@/components/strategies/strategy-request-form";
import { AddYourStrategyForm } from "@/components/strategies/add-your-strategy-form";

const STATUS_LABEL: Record<StrategyCardStatus, string> = {
  active: "Active",
  trial: "Trial",
  included: "Included",
  locked: "Locked",
};

function groupSetfiles(rows: SetfileRow[]): Partial<Record<StrategyKey, SetfileRow[]>> {
  const groups: Partial<Record<StrategyKey, SetfileRow[]>> = {};
  for (const row of rows) {
    (groups[row.strategyKey] ??= []).push(row);
  }
  return groups;
}

/** Prefer the verified variant for the catalogue card's short blurb; falls back to the first
 * published example when a strategy has no verified setfile yet. */
function pickRepresentative(rows: SetfileRow[] | undefined): SetfileRow | null {
  if (!rows || rows.length === 0) return null;
  return rows.find((r) => r.source === "verified") ?? rows[0];
}

export default async function StrategiesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const switchablePanels = getReachablePanels(session.user.roles);
  if (isAdminUser(session.user)) redirect("/admin/dashboard");

  const [paid, config, setfiles, activeLicenses] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getPortalConfig(),
    listActiveSetfiles().catch(() => []),
    getActiveLicenseDetailsForUser(session.user.id).catch(() => []),
  ]);
  const isAdmin = isAdminUser(session.user);
  // Same aggregation drives the card status below and the sidebar badge (thread
  // multi-license-visibility-2026-08-31, marcus) — a paying client must never see "Trial", or a
  // lower-tier sidebar badge, just because an older/newer license sorts differently.
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";
  const groups = groupSetfiles(setfiles);
  const bestLicenseTier = tier === "free" ? null : tier;
  const status = computeStrategyCardStatus({ paid, licenseTier: bestLicenseTier, isAdmin });

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      <div className="comm-head">
        <h1>Strategies</h1>
        <p>Every strategy Horizon runs — what it does, how it&apos;s tuned, and what feed it wants.</p>
      </div>

      <div className="fp-grid">
        {STRATEGY_ORDER.map((key) => {
          const meta = STRATEGY_DISPLAY_META[key];
          const rep = pickRepresentative(groups[key]);

          return (
            <Link key={key} href={`/strategies/${key}`} className={`card fp-card fp-${status}`}>
              <div className="fp-top">
                <span className="fp-colo">{strategyColoCode(meta)}</span>
                <span className={`fp-pill fp-pill-${status}`}>{STATUS_LABEL[status]}</span>
              </div>
              <h3 className="fp-name">{meta.name}</h3>
              <p className="fp-desc">{meta.hook}</p>
              <span className="fp-latency">{meta.marketFocus}</span>

              {status === "included" && <span className="fp-note">Admin access</span>}
              {status === "locked" && <span className="fp-note">🔒 Upgrade to unlock</span>}
              {!rep && <span className="fp-note">Setfile detail coming soon</span>}
            </Link>
          );
        })}
      </div>

      {status === "locked" && (
        <p className="fp-footnote">
          Strategies are bundled with your license. Message us on Telegram to talk through which fit your setup.
        </p>
      )}

      <div className="fp-ctas">
        <div className="card fp-cta-card">
          <h3 className="fp-cta-title">Request a strategy</h3>
          <p className="fp-cta-copy">
            Have an idea for a strategy we don&apos;t run yet? Tell us what you&apos;re thinking and we&apos;ll
            scope it.
          </p>
          <StrategyRequestForm />
        </div>

        <div className="card fp-cta-card">
          <h3 className="fp-cta-title">Add your strategy</h3>
          <p className="fp-cta-copy">
            Already built something that works? Pitch it to us with the details and we&apos;ll review it.
          </p>
          <AddYourStrategyForm />
        </div>

        <div className="card fp-consult-card">
          <span className="fp-consult-badge">CONSULTING</span>
          <h3 className="fp-cta-title">Custom strategy, built for you</h3>
          <p className="fp-cta-copy">
            We design, build, and tune a strategy around your instrument, timeframe, and risk appetite.
          </p>
          <a className="btn primary sm" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
            Talk to us →
          </a>
        </div>
      </div>

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
