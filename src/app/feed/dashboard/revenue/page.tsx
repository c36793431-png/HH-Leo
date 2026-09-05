import { Fragment } from "react";
import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { listTiersForProvider } from "@/lib/feed-providers";
import { groupTiers } from "@/lib/feed-provider-packages";

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** No payment ledger tracks feed-provider revenue splits yet, and no subscriber counts
 * exist to weight a total against, so this page shows per-package list price and per-tier
 * 50% share only, with no aggregate figure. Flagged to marcus as follow-up scope (real
 * payout pipeline + a package concept to dedupe bundled tiers). Package grouping itself
 * lives in @/lib/feed-provider-packages, shared with the Feeds tab. */

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
                          <span style={{ fontSize: 11, color: "var(--pfp-ink-hi)" }}>{t.subtitle}</span>
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
                      <span style={{ fontSize: 11, color: "var(--pfp-ink-hi)" }}>{money(g.tier.priceCents ?? 0)} / mo</span>
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
