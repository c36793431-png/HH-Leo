import { Fragment } from "react";
import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { listTiersForProvider, type ProviderTierRow } from "@/lib/feed-providers";

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** No payment ledger tracks feed-provider revenue splits yet, and no subscriber counts
 * exist to weight a total against, so this page shows per-package list price and per-tier
 * 50% share only, with no aggregate figure. Flagged to marcus as follow-up scope (real
 * payout pipeline + a package concept to dedupe bundled tiers). */

/** feed_tiers has no package concept (coxwell hasn't decided that schema yet) -- this
 * grouping is a hardcoded literal in the component, not data. It exists only to stop the
 * "By tier" table from reading as five separately-priced $30 sales when London's three
 * tiers and NY's two tiers are each sold together as one package. If a sixth tier is
 * added to feed_tiers, it will NOT be picked up here automatically -- it falls through to
 * its own ungrouped row below, and this list needs a manual update to fold it into a
 * package. */
const PACKAGES: { label: string; tierKeys: string[] }[] = [
  { label: "London Base", tierKeys: ["ld-beta-56", "ld-gamma-19", "ld-delta-18"] },
  { label: "NY", tierKeys: ["ny-normal", "ny-fast"] },
];

type TierGroup =
  | { kind: "package"; label: string; priceCents: number; members: ProviderTierRow[] }
  | { kind: "single"; tier: ProviderTierRow };

function groupTiers(tiers: ProviderTierRow[]): TierGroup[] {
  const used = new Set<string>();
  const groups: TierGroup[] = [];

  for (const pkg of PACKAGES) {
    const members = tiers.filter((t) => pkg.tierKeys.includes(t.tierKey));
    if (members.length === 0) continue;
    members.forEach((t) => used.add(t.id));
    groups.push({ kind: "package", label: pkg.label, priceCents: members[0].priceCents ?? 0, members });
  }

  for (const t of tiers) {
    if (!used.has(t.id)) groups.push({ kind: "single", tier: t });
  }

  return groups;
}

export default async function FeedRevenuePage() {
  const session = await auth();
  const tiers = await listTiersForProvider(session!.user!.id!);
  const groups = groupTiers(tiers);

  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>Revenue</h1>
          <div className="crumb">feed.horizonhft.com / revenue</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        <div className="banner info">
          <span className="bic">▦</span>
          <div>
            <b>No payout ledger yet</b> — figures below are notional (per-package list price ÷ 2), not a real
            payment split. Payout history and next-payout date are static preview copy.
          </div>
        </div>

        <div className="card full">
          <div className="chead">
            <span className="ic">◈</span>
            <h3>By package</h3>
            <span className="cap">list price only</span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Package / tier</th>
                <th className="r">List price</th>
                <th className="r">Your 50%</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) =>
                g.kind === "package" ? (
                  <Fragment key={`pkg-${g.label}`}>
                    <tr>
                      <td>
                        <b>{g.label}</b>
                      </td>
                      <td className="r mono">{money(g.priceCents)}</td>
                      <td className="r share">{money(Math.round(g.priceCents / 2))}</td>
                    </tr>
                    {g.members.map((t) => (
                      <tr key={t.id}>
                        <td style={{ paddingLeft: 28 }}>
                          {t.name}
                          <br />
                          <span style={{ fontSize: 11, color: "var(--pfp-ink-3)" }}>{t.speedDisplay}</span>
                        </td>
                        <td className="r" />
                        <td className="r" />
                      </tr>
                    ))}
                  </Fragment>
                ) : (
                  <tr key={g.tier.id}>
                    <td>
                      <b>{g.tier.name}</b>
                      <br />
                      <span style={{ fontSize: 11, color: "var(--pfp-ink-3)" }}>{money(g.tier.priceCents ?? 0)} / mo</span>
                    </td>
                    <td className="r mono">{money(g.tier.priceCents ?? 0)}</td>
                    <td className="r share">{money(Math.round((g.tier.priceCents ?? 0) / 2))}</td>
                  </tr>
                )
              )}
              {tiers.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ textAlign: "center", color: "var(--pfp-ink-3)", padding: "24px 0" }}>
                    No tiers assigned yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="foot">HORIZON HFT · provider panel · Revenue</div>
      </section>
    </>
  );
}
