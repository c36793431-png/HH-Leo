import { Fragment } from "react";
import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { listTiersForProvider } from "@/lib/feed-providers";
import { groupTiers } from "@/lib/feed-provider-packages";

const REGION_LABEL: Record<string, string> = { london: "London", ny: "New York", cme: "CME", tokyo: "Tokyo" };

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Read-only catalogue view (bus thread feed-provider-feeds-tab-2026-09-02, Stage 1) --
 * one row per feed_tiers row owned by this provider. No per-row actions: coxwell's standing
 * rule is list = summary, detail page = editing, and no editing surface exists yet.
 * Columns beyond identity are what the tier is sold on (latency, redundancy, support) --
 * description is dropped from the row: it's a full sentence and would dominate/duplicate
 * the subtitle line. is_flagship is left off deliberately -- Horizon's curation flag, not
 * a fact about the provider's own feed. Tiers that belong to a package (@/lib/feed-provider-packages,
 * shared with Revenue) are grouped under one priced header row so e.g. NY's two tiers don't
 * each look like a separate $30 product -- member rows below keep their specs but not a price. */
export default async function FeedFeedsPage() {
  const session = await auth();
  const tiers = await listTiersForProvider(session!.user!.id!);
  const groups = groupTiers(tiers);

  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>Feeds</h1>
          <div className="crumb">feed.horizonhft.com / feeds</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        <div className="card full">
          <div className="chead">
            <span className="ic">❖</span>
            <h3>By package</h3>
            <span className="cap">{tiers.length} assigned</span>
          </div>

          {tiers.length === 0 ? (
            <div className="empty">
              <div className="eic">❖</div>
              <b>No tiers assigned yet</b>
              <p>
                Once Horizon assigns a feed tier to your account, it shows up here with its region and list
                price. Reach out if you were expecting to see one.
              </p>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Region</th>
                  <th>Latency</th>
                  <th>Redundancy</th>
                  <th>Support</th>
                  <th className="r">List price</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) =>
                  g.kind === "package" ? (
                    <Fragment key={`pkg-${g.label}`}>
                      <tr>
                        <td colSpan={5}>
                          <b>{g.label}</b>
                        </td>
                        <td className="r mono">{money(g.priceCents)} / mo</td>
                      </tr>
                      {g.members.map((t) => (
                        <tr key={t.id}>
                          <td style={{ paddingLeft: 28 }}>
                            {t.name}
                            <br />
                            <span style={{ fontSize: 11, color: "var(--pfp-ink-3)" }}>{t.subtitle}</span>
                          </td>
                          <td>{REGION_LABEL[t.region] ?? t.region}</td>
                          <td className="mono">{t.latencyUs != null ? `${t.latencyUs}µs` : t.speedDisplay}</td>
                          <td>{t.pathRedundancy}</td>
                          <td>{t.supportLevel}</td>
                          <td className="r" />
                        </tr>
                      ))}
                    </Fragment>
                  ) : (
                    <tr key={g.tier.id}>
                      <td>
                        <b>{g.tier.name}</b>
                        <br />
                        <span style={{ fontSize: 11, color: "var(--pfp-ink-3)" }}>{g.tier.subtitle}</span>
                      </td>
                      <td>{REGION_LABEL[g.tier.region] ?? g.tier.region}</td>
                      <td className="mono">{g.tier.latencyUs != null ? `${g.tier.latencyUs}µs` : g.tier.speedDisplay}</td>
                      <td>{g.tier.pathRedundancy}</td>
                      <td>{g.tier.supportLevel}</td>
                      <td className="r mono">{g.tier.priceCents != null ? `${money(g.tier.priceCents)} / mo` : "—"}</td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="foot">HORIZON HFT · provider panel · Feeds</div>
      </section>
    </>
  );
}
