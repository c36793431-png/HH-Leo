import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdminUser, isFeedProviderUser } from "@/lib/admin-users-panel";
import { SignOutButton } from "@/components/sign-out-button";
import "./feed-landing.css";

/** Public landing for feed.horizonhft.com's root -- mirrors src/app/partner/page.tsx's shape
 * (proxy.ts rewrites "/" to "/feed" on this host, so this replaces the old FeedRootPage that
 * just redirect()'d straight to /dashboard). Ported from the locked feed-provider-landing
 * mockup (Iris/Atlas design, brief iris-feed-provider-front-page-design-2026-08-22,
 * mockups/horizon-feed-provider/feed-provider-landing.html) -- bus thread
 * leo-feed-landing-implementation-2026-08-22.
 *
 * A signed-in feed provider (or admin) is sent straight to /dashboard, same treatment as an
 * approved partner on partner.horizonhft.com. Everyone else -- unauthenticated visitors and
 * signed-in non-provider members -- sees the landing (feed providers are admin-onboarded, not
 * self-signup, so there's no apply form to embed like partner's apply flow). This preserves the
 * 74d48cc redirect-loop fix: feed/dashboard/layout.tsx still owns the off-host bounce for a
 * signed-in non-provider who navigates straight to /dashboard.
 *
 * Deviations from the mockup (all intentional):
 *  - No Google Fonts <link> tags -- reuses the --font-inter/--font-saira/--font-jetbrains-mono
 *    vars already loaded on <html> in app/layout.tsx, same as partner-landing.css.
 *  - "Provider login" / dashboard preview / docs links point at /dashboard and /dashboard/docs
 *    (rewritten to /feed/dashboard, /feed/dashboard/docs by proxy.ts on this host) instead of
 *    the mockup's non-existent /providers/login, /providers/docs routes.
 *  - "Apply to publish" CTAs link to /providers/apply, the self-serve application page shipped
 *    in the login/apply pass (leo-feed-login-and-apply-implementation-2026-08-22) -- this file
 *    predates that discovery and had wrongly pointed them at a mailto: link instead.
 *  - Mockup's own footer + Terms/Privacy links dropped -- the global <Footer/> from
 *    app/layout.tsx covers this page too, and no /terms or /privacy routes exist.
 *  - Small "signed in as" chip + sign-out added to the nav for a signed-in non-provider member,
 *    mirroring partner-landing's treatment (mockup itself has no signed-in nav state).
 */
export default async function FeedLandingPage() {
  const session = await auth();
  const user = session?.user ?? null;

  if (user?.id && (isFeedProviderUser(user) || isAdminUser(user))) {
    redirect("/dashboard");
  }

  const loggedIn = Boolean(user?.id);
  const memberLabel = user?.name?.trim() || user?.email?.trim() || "member";
  const memberInitial = memberLabel.charAt(0).toUpperCase();

  return (
    <div className="feed-landing-v1">
      <div className="fl-wrap">
        {/* TOP BAR */}
        <nav className="fl-nav">
          <a className="fl-brand" href="#">
            <span className="fl-glyph">
              <Image src="/logo.png" alt="Horizon HFT" width={42} height={42} priority />
            </span>
            <span className="fl-txt">
              HORIZON
              <small>HFT <span className="fl-net">· FEED NETWORK</span></small>
            </span>
          </a>
          <span className="fl-sp" />
          <span className="fl-nav-links">
            {loggedIn && (
              <span className="fl-signedin">
                <span className="fl-av">{memberInitial}</span>Signed in as <b>{memberLabel}</b>
                <SignOutButton className="fl-subtle" redirectTo="/" />
              </span>
            )}
            <a className="fl-trader-link" href="https://portal.horizonhft.com">
              <svg className="fl-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12h4l3-8 4 16 3-8h4" />
              </svg>
              Looking to subscribe?
            </a>
            <a className="fl-subtle" href="/dashboard">
              Provider login
            </a>
            <a className="fl-btn fl-primary fl-small" href="/providers/apply">
              Apply to publish
            </a>
          </span>
        </nav>

        {/* HERO */}
        <section className="fl-hero">
          <div className="fl-h-left">
            <span className="fl-seal" aria-hidden="true">
              <Image src="/logo.png" alt="" width={32} height={32} />
            </span>

            <div className="fl-eyebrow">
              <span className="fl-dot" />
              HORIZON FEED NETWORK · FOR PROVIDERS
            </div>

            <h1>
              Publish your feed.
              <br />
              <em>Reach traders who pay for quality.</em>
            </h1>

            <p className="fl-sub">
              Horizon distributes market-data feeds to institutional desks and an active retail trading community.
              Bring your feed onto the network — we <b>measure it transparently</b>, list it in front of subscribers,
              and <b>share revenue on every one you win.</b> No gatekeeping if the quality is real.
            </p>

            <ul className="fl-pillars" aria-label="Why publish on Horizon">
              <li className="fl-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="3" />
                  <path d="M21 20v-2a4 4 0 0 0-3-3.87M16 4.13A4 4 0 0 1 16 12" />
                </svg>
                Institutional&nbsp;+&nbsp;retail reach
              </li>
              <li className="fl-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3v18h18" />
                  <path d="m7 15 3-4 3 2 4-6" />
                </svg>
                Transparent uptime
              </li>
              <li className="fl-pill fl-earn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
                Revenue share
              </li>
              <li className="fl-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 11 3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                Admin-reviewed
              </li>
            </ul>

            <div className="fl-cta">
              <a className="fl-btn fl-primary" href="/providers/apply">
                Apply to publish your feed <span className="fl-ar">→</span>
              </a>
              <a className="fl-btn fl-ghost" href="/dashboard">
                Provider login
              </a>
            </div>
            <div className="fl-reassure">
              <span className="fl-ic">✓</span>
              <b>Reviewed for signal quality before listing — no cost to apply, no exclusivity required.</b>
            </div>
          </div>

          <div className="fl-h-right">
            <div className="fl-provcard" aria-hidden="true">
              <div className="fl-pc-head">
                <div className="fl-pc-brand">
                  <span className="fl-g" aria-hidden="true">
                    <Image src="/logo.png" alt="" width={16} height={16} />
                  </span>
                  <span className="fl-nm">
                    Your Feed
                    <s>feed.horizonhft.com / provider</s>
                  </span>
                </div>
                <span className="fl-pc-pill">
                  <span className="fl-d" />
                  Active provider
                </span>
              </div>
              <div className="fl-pc-kpis">
                <div className="fl-pc-kpi">
                  <div className="fl-k">
                    248 <small>+19</small>
                  </div>
                  <div className="fl-kl">Active subscribers</div>
                </div>
                <div className="fl-pc-kpi fl-money">
                  <div className="fl-k">$ —</div>
                  <div className="fl-kl">Est. payout · this cycle</div>
                </div>
              </div>
              <div className="fl-pc-sec">Subscribers by tier</div>
              <div className="fl-tier">
                <span className="fl-tn">L5 · Ultra</span>
                <span className="fl-tb">
                  <i style={{ width: "88%" }} />
                </span>
                <span className="fl-tv">96</span>
              </div>
              <div className="fl-tier">
                <span className="fl-tn">L4 · Pro</span>
                <span className="fl-tb">
                  <i style={{ width: "66%" }} />
                </span>
                <span className="fl-tv">72</span>
              </div>
              <div className="fl-tier">
                <span className="fl-tn">L3 · Core</span>
                <span className="fl-tb">
                  <i style={{ width: "48%" }} />
                </span>
                <span className="fl-tv">54</span>
              </div>
              <div className="fl-tier">
                <span className="fl-tn">L2 · Lite</span>
                <span className="fl-tb">
                  <i style={{ width: "24%" }} />
                </span>
                <span className="fl-tv">26</span>
              </div>
              <div className="fl-pc-foot">
                <span>uptime</span>
                <span className="fl-lv">99.98%</span>
                <span>·</span>
                <span>gaps</span>
                <span className="fl-lv">0</span>
                <span className="fl-measured">
                  <span className="fl-mi">◈</span>Measured by Horizon
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* TRUST STRIP */}
        <section className="fl-trust">
          <div className="fl-trust-in">
            <div className="fl-tcell">
              <div className="fl-tv">
                Live<span className="fl-u"> desks</span>
              </div>
              <div className="fl-tl">Institutional + retail subscribers on the network</div>
            </div>
            <div className="fl-tcell">
              <div className="fl-tv">
                5<span className="fl-u"> tiers</span>
              </div>
              <div className="fl-tl">Capability-graded distribution, L1–L5</div>
            </div>
            <div className="fl-tcell">
              <div className="fl-tv">Open</div>
              <div className="fl-tl">Benchmark methodology, published &amp; auditable</div>
            </div>
            <div className="fl-tcell">
              <div className="fl-tv">Measured</div>
              <div className="fl-tl">Uptime &amp; latency by Horizon, not self-reported</div>
            </div>
          </div>
        </section>

        {/* VALUE PROPS */}
        <section className="fl-props">
          <div className="fl-prop">
            <div className="fl-pic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M17 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 10a3 3 0 100-6 3 3 0 000 6M21 20v-2a4 4 0 00-3-3.87M16 4.13A4 4 0 0116 12"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h3>Reach that pays</h3>
            <p>
              Your feed goes in front of institutional desks and an active retail trading community already inside
              Horizon — demand that&rsquo;s hard to build alone.
            </p>
          </div>
          <div className="fl-prop">
            <div className="fl-pic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M3 3v18h18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                <path d="m7 15 3-4 3 2 4-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>Measured, not claimed</h3>
            <p>
              Uptime, tick rate, and gaps are measured by Horizon and shown the same way in our open Feed Comparison
              — your quality speaks for itself, no invented vendor numbers.
            </p>
          </div>
          <div className="fl-prop fl-money">
            <div className="fl-pic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h3>Revenue on every subscriber</h3>
            <p>
              Earn a transparent share on each trader who subscribes to your tiers. Payouts, statements, and
              platform-fee breakdowns live in your panel — reconcilable, every cycle.
            </p>
          </div>
          <div className="fl-prop">
            <div className="fl-pic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2} />
                <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>No gatekeeping</h3>
            <p>
              We don&rsquo;t play favorites. If your feed is genuinely fast and clean, it lists — capability tier is
              set by the measurement, not by who you know.
            </p>
          </div>
          <div className="fl-prop">
            <div className="fl-pic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="m9 11 3 3L22 4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                <path
                  d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h3>Reviewed onboarding</h3>
            <p>
              Every feed is admin-reviewed before it lists — a quality bar that protects the network&rsquo;s
              reputation, and yours, from noisy signals sitting next to real ones.
            </p>
          </div>
          <div className="fl-prop">
            <div className="fl-pic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="4" width="18" height="14" rx="2" stroke="currentColor" strokeWidth={2} />
                <path d="M3 10h18M8 15h4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>Self-serve panel</h3>
            <p>
              Publish tiers, set trial rules, watch live feed health, and pull statements — all from a provider
              console. You run your offering; the admin only steps in as an exception.
            </p>
          </div>
        </section>

        {/* PROGRAMME BAND */}
        <section className="fl-provband">
          <div className="fl-pb-in">
            <div className="fl-pb-left">
              <span className="fl-pb-eyebrow">
                <span className="fl-d" />
                How it works
              </span>
              <h2>
                From application to <em>first payout.</em>
              </h2>
              <p className="fl-pb-sub">
                Four steps. You keep control of your tiers, pricing, and trial rules — Horizon handles distribution,
                measurement, and billing.
              </p>
              <div className="fl-steps">
                <div className="fl-step">
                  <span className="fl-n">1</span>
                  <div className="fl-sx">
                    <b>Apply</b>
                    <p>Tell us about your feed — venues, protocol, coverage. No cost, no exclusivity.</p>
                  </div>
                </div>
                <div className="fl-step">
                  <span className="fl-n">2</span>
                  <div className="fl-sx">
                    <b>Reviewed &amp; measured</b>
                    <p>We benchmark uptime, latency, and gaps, then set a capability tier from the data.</p>
                  </div>
                </div>
                <div className="fl-step">
                  <span className="fl-n">3</span>
                  <div className="fl-sx">
                    <b>Publish your tiers</b>
                    <p>Go live in the provider panel — name your tiers, set trial rules, list to subscribers.</p>
                  </div>
                </div>
                <div className="fl-step fl-earn">
                  <span className="fl-n">4</span>
                  <div className="fl-sx">
                    <b>Earn on subscribers</b>
                    <p>Revenue share on every subscription, with statements and payouts each cycle.</p>
                  </div>
                </div>
              </div>
              <div className="fl-pb-cta">
                <a className="fl-btn fl-primary" href="/providers/apply">
                  Start your application <span className="fl-ar">→</span>
                </a>
                <a className="fl-btn fl-ghost" href="/dashboard/docs">
                  Integration docs
                </a>
              </div>
            </div>
            <div className="fl-pb-right">
              <div className="fl-dashthumb" aria-hidden="true">
                <aside className="fl-dt-rail">
                  <div className="fl-dt-brand">
                    <span className="fl-g" />
                    <span className="fl-t">
                      Horizon
                      <s>PROVIDER</s>
                    </span>
                  </div>
                  <div className="fl-dt-nav fl-on">
                    <span className="fl-ic">
                      <svg viewBox="0 0 24 24">
                        <rect x="3" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" />
                      </svg>
                    </span>
                    Overview
                  </div>
                  <div className="fl-dt-nav">
                    <span className="fl-ic">
                      <svg viewBox="0 0 24 24">
                        <path d="M4 20V10M12 20V4M20 20v-6" />
                      </svg>
                    </span>
                    My Tiers
                  </div>
                  <div className="fl-dt-nav">
                    <span className="fl-ic">
                      <svg viewBox="0 0 24 24">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                      </svg>
                    </span>
                    Subscribers
                  </div>
                  <div className="fl-dt-nav">
                    <span className="fl-ic">
                      <svg viewBox="0 0 24 24">
                        <path d="M3 12h4l2-6 4 12 2-6h6" />
                      </svg>
                    </span>
                    Feed Health
                  </div>
                  <div className="fl-dt-nav">
                    <span className="fl-ic">
                      <svg viewBox="0 0 24 24">
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                      </svg>
                    </span>
                    Revenue
                  </div>
                </aside>
                <div className="fl-dt-main">
                  <div className="fl-dt-head">
                    <span className="fl-dd" />
                    <span className="fl-dtt">feed.horizonhft.com / provider</span>
                    <span className="fl-dtag">
                      <span className="fl-d" />
                      ACTIVE PROVIDER
                    </span>
                  </div>
                  <div className="fl-dt-kpis">
                    <div className="fl-dt-kpi">
                      <div className="fl-k">
                        248 <small>+19</small>
                      </div>
                      <div className="fl-kl">Active subscribers</div>
                    </div>
                    <div className="fl-dt-kpi">
                      <div className="fl-k">
                        99.98<small>%</small>
                      </div>
                      <div className="fl-kl">Uptime · 30d</div>
                    </div>
                    <div className="fl-dt-kpi">
                      <div className="fl-k">14</div>
                      <div className="fl-kl">Trials running</div>
                    </div>
                    <div className="fl-dt-kpi fl-money">
                      <div className="fl-k">◈ net</div>
                      <div className="fl-kl">Est. payout</div>
                    </div>
                  </div>
                  <div className="fl-dt-sec">Subscribers by tier</div>
                  <div className="fl-dt-tier">
                    <span className="fl-tn">Ultra</span>
                    <span className="fl-tb">
                      <i style={{ width: "88%" }} />
                    </span>
                    <span className="fl-tv">96</span>
                  </div>
                  <div className="fl-dt-tier">
                    <span className="fl-tn">Pro</span>
                    <span className="fl-tb">
                      <i style={{ width: "66%" }} />
                    </span>
                    <span className="fl-tv">72</span>
                  </div>
                  <div className="fl-dt-tier">
                    <span className="fl-tn">Core</span>
                    <span className="fl-tb">
                      <i style={{ width: "48%" }} />
                    </span>
                    <span className="fl-tv">54</span>
                  </div>
                  <div className="fl-dt-tier">
                    <span className="fl-tn">Lite</span>
                    <span className="fl-tb">
                      <i style={{ width: "24%" }} />
                    </span>
                    <span className="fl-tv">26</span>
                  </div>
                  <div className="fl-pb-mask" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* APPLY BAND */}
        <section className="fl-applyband">
          <div className="fl-ab-in">
            <h2>
              Have a feed worth <em>distributing?</em>
            </h2>
            <p>
              Bring it onto the Horizon network. We&rsquo;ll measure it honestly, put it in front of subscribers who
              pay for quality, and share the revenue you earn.
            </p>
            <div className="fl-ab-cta">
              <a className="fl-btn fl-primary" href="/providers/apply">
                Apply to publish your feed <span className="fl-ar">→</span>
              </a>
              <a className="fl-btn fl-ghost" href="/dashboard">
                Provider login
              </a>
            </div>
            <div className="fl-ab-note">
              <span className="fl-ic">✓</span>Applications are admin-reviewed for signal quality. No cost to apply ·
              no exclusivity required.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
