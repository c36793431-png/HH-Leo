import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { listTiersForProvider } from "@/lib/feed-providers";

function money(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

/** Real feed_tiers rows assigned to this provider (feed_tiers.provider_user_id, 0058) --
 * no draft/review workflow exists yet (new-tier publishing + Horizon review gate from the
 * mockup is unbuilt), so this ships as a read-only list of currently-assigned tiers rather
 * than faking the "+ New tier" / draft states shown in Iris's mockup. */
export default async function FeedMyTiersPage() {
  const session = await auth();
  const tiers = await listTiersForProvider(session!.user!.id!);

  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>My Tiers</h1>
          <div className="crumb">feed.horizonhft.com / tiers</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        <div className="banner info">
          <span className="bic">◈</span>
          <div>
            New-tier publishing and the draft → Horizon-review workflow aren&apos;t built yet — this is a
            read-only view of the tiers currently assigned to your account. Ask Horizon to add or change a tier
            assignment for now.
          </div>
        </div>

        {tiers.length === 0 ? (
          <div className="card full">
            <div className="empty">
              <div className="eic">◈</div>
              <b>No tiers assigned yet</b>
              <p>Horizon hasn&apos;t assigned any feed_tiers rows to your provider account.</p>
            </div>
          </div>
        ) : (
          <div className="tiers">
            {tiers.map((t) => (
              <div className="tier-card" key={t.id}>
                <div className="th">
                  <div className="lv">
                    <span style={{ fontSize: 11, color: "var(--pfp-ink-3)", textTransform: "uppercase" }}>{t.region}</span>
                  </div>
                  <div className="tname">
                    <h4>
                      {t.name} <span className="tb active">● Live</span>
                    </h4>
                    <p>{t.subtitle}</p>
                  </div>
                </div>
                <div className="tier-meta">
                  <div className="m">
                    <div className="k">Client price</div>
                    <div className="v mut">
                      {money(t.priceCents)}
                      <small>/mo</small>
                    </div>
                  </div>
                  <div className="m">
                    <div className="k">You earn / sub</div>
                    <div className="v cyan">
                      {money(t.priceCents != null ? Math.round(t.priceCents / 2) : null)}
                      <small>/mo</small>
                    </div>
                  </div>
                </div>
                <div className="tier-foot">
                  <span className="tb draft" style={{ background: "rgba(45,226,230,.08)", color: "var(--pfp-cyan)", borderColor: "var(--pfp-card-line)" }}>
                    50 / 50 split
                  </span>
                  <div className="sp" />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="scope-note" style={{ marginTop: 20 }}>
          <span className="i">ⓘ</span>
          <span>
            <b style={{ color: "var(--pfp-ink)" }}>You earn / sub</b> is your 50% share of the client price —
            Horizon keeps the other 50%. Trial length is a platform default (7 days) — per-tier trial-rule
            overrides aren&apos;t built yet.
          </span>
        </div>

        <div className="foot">HORIZON HFT · provider panel · My Tiers</div>
      </section>
    </>
  );
}
