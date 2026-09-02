import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { listTiersForProvider } from "@/lib/feed-providers";

const REGION_LABEL: Record<string, string> = { london: "London", ny: "New York", cme: "CME", tokyo: "Tokyo" };

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Read-only catalogue view (bus thread feed-provider-feeds-tab-2026-09-02, Stage 1) --
 * one row per feed_tiers row owned by this provider. No per-row actions: coxwell's standing
 * rule is list = summary, detail page = editing, and no editing surface exists yet. */
export default async function FeedFeedsPage() {
  const session = await auth();
  const tiers = await listTiersForProvider(session!.user!.id!);

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
            <h3>Your tiers</h3>
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
                  <th>Tier key</th>
                  <th>Region</th>
                  <th className="r">List price</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <b>{t.name}</b>
                      <br />
                      <span style={{ fontSize: 11, color: "var(--pfp-ink-3)" }}>{t.subtitle}</span>
                    </td>
                    <td className="mono">{t.tierKey}</td>
                    <td>{REGION_LABEL[t.region] ?? t.region}</td>
                    <td className="r mono">{t.priceCents != null ? `${money(t.priceCents)} / mo` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="foot">HORIZON HFT · provider panel · Feeds</div>
      </section>
    </>
  );
}
