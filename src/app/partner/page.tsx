import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdminUser, isPartnerUser } from "@/lib/admin-users-panel";
import { getPendingPartnerApplicationForUser } from "@/lib/partner-applications";
import { PartnerApplyForm } from "@/components/partner/partner-apply-form";
import { SignOutButton } from "@/components/sign-out-button";
import "./partner-landing.css";

interface RawSearchParams {
  status?: string;
}

/** Public landing for partner.horizonhft.com's root — no pricing, per the affiliate-only
 * pricing policy (bus thread horizon-contact-for-pricing-swap-2026-08-21). Visiting this host
 * auto-attributes a referral cookie (see proxy.ts withPartnerRefCookie), so the Apply form
 * embedded below is what actually credits the partner once attributeReferralFromCookie runs
 * on a later signup. The partner's own dashboard lives at /partner/dashboard, session-gated
 * separately (dashboard/layout.tsx).
 *
 * Rebuilt to match the locked partner-landing-v3 mockup (Iris/Atlas design, brief
 * iris-partner-landing-redesign-v2-2026-08-21, mockups/horizon-referral-partner/
 * partner-landing-v3.html) — leo-partner-v3-mockup-2026-08-22. Structure, top to bottom:
 * hero ("how partners earn" panel), dashboard preview, "what your community gets" grid,
 * embedded apply form + auth-gate note, slim trust strip (global <Footer/> from
 * app/layout.tsx supplies the actual footer, so the mockup's own footer markup is dropped
 * here to avoid a duplicate). Mockup's three body states (state-invited / state-loggedin /
 * state-submitted) map to: session-less visitor, signed-in non-partner member (nav chip +
 * auth-gate copy swap), and PartnerApplyForm's own submitted state.
 *
 * Deviations from the mockup (all intentional, see HANDOFF_partner_v3_landing_rebuild_
 * 2026-08-22.md for the writeup):
 *  - "Partner login" links to /partner/dashboard, not /partner/login (that route doesn't
 *    exist) -- /partner/dashboard's own auth gate sends signed-out visitors to /login and
 *    signed-in non-partners back here with an explanatory status.
 *  - The apply form has no "expected referral volume" field -- the underlying server
 *    action/table (partner_applications, createPartnerApplicationAction) doesn't have a
 *    column for it and this task was scoped to not touch that backend.
 *  - Telegram handle is optional here (matches the existing form/action), not required as
 *    the mockup's asterisk implies.
 *  - An approved partner (role "partner"/"admin") who's signed in is redirected straight to
 *    /partner/dashboard instead of seeing the landing page, same as the old page.tsx. */
export default async function PartnerLandingPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const session = await auth();
  const user = session?.user ?? null;

  if (user?.id && (isPartnerUser(user) || isAdminUser(user))) {
    redirect("/partner/dashboard");
  }

  const loggedIn = Boolean(user?.id);
  const memberLabel = user?.name?.trim() || user?.email?.trim() || "member";
  const memberInitial = memberLabel.charAt(0).toUpperCase();

  // ?status= carried over from dashboard/layout.tsx's redirects (via the retired
  // /partner/apply route) -- cosmetic messaging only, not an access gate.
  let pendingApplication = false;
  if (loggedIn && user?.id) {
    if (sp.status === "pending") {
      pendingApplication = true;
    } else {
      pendingApplication = Boolean(await getPendingPartnerApplicationForUser(user.id, user.email ?? null));
    }
  }

  return (
    <div className="partner-v3">
      <div className="pv-backdrop" aria-hidden="true">
        <div className="glow" />
        <div className="grid" />
      </div>
      <div className="pv-wrap">
        {/* TOP BAR */}
        <nav className="pv-nav">
          <a className="pv-brand" href="#">
            <span className="glyph">
              <Image src="/brand/horizon-logo-partner.png" alt="Horizon HFT" width={42} height={42} priority />
            </span>
            <span className="txt">
              HORIZON
              <small>HFT · PARTNER PROGRAM</small>
            </span>
          </a>
          <span className="pv-nav-links">
            {loggedIn && (
              <span className="pv-nav-signed">
                <span className="av">{memberInitial}</span>Signed in as <b>{memberLabel}</b>
                <SignOutButton className="pv-signout" redirectTo="/" />
              </span>
            )}
            <a className="subtle" href="/login">
              Member login
            </a>
            <a className="pv-partner-link" href="/partner/dashboard">
              <svg
                className="ic"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m11 17 2 2a1 1 0 1 0 3-3" />
                <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
                <path d="m21 3 1 11h-2" />
                <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
                <path d="M3 4h8" />
              </svg>
              Partner login
            </a>
          </span>
        </nav>

        {/* 1 · HERO — PARTNER PROGRAM */}
        <section className="pv-hero pv-section">
          <div>
            <span className="pv-seal" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <path d="m11 17 2 2a1 1 0 1 0 3-3" />
                <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
                <path d="m21 3 1 11h-2" />
                <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
                <path d="M3 4h8" />
              </svg>
            </span>
            <div className="pv-eyebrow">
              <span className="dot" />
              Horizon Partner Program
            </div>
            <h1>
              Bring your community.
              <br />
              <em>Earn on every referral.</em>
            </h1>
            <p className="pv-sub">
              Already sending traders to Horizon HFT? Turn it into a durable revenue line. Partners get a{" "}
              <b>private dashboard</b>, a <b>referral link</b>, and <b>recurring commission</b> on every member they
              bring — with tier bonuses as your book grows.
            </p>
            <ul className="pv-list">
              <li>
                <span className="chk">✓</span>
                <span>
                  <b>Recurring commission</b> — earn for as long as your referrals stay subscribed.
                </span>
              </li>
              <li>
                <span className="chk">✓</span>
                <span>
                  <b>Tier bonuses</b> — commission scales as your referred book grows.
                </span>
              </li>
              <li>
                <span className="chk">✓</span>
                <span>
                  <b>Partner dashboard</b> — track referrals, status, and payouts in real time.
                </span>
              </li>
            </ul>
            <div className="pv-cta">
              <a className="pv-btn amber" href="#apply">
                Apply to become a partner <span className="ar">→</span>
              </a>
              <a className="pv-btn amber-ghost" href="/partner/dashboard">
                Partner login
              </a>
            </div>
            <div className="pv-reassure">
              <span className="ic">✓</span>
              <b>Free to apply · we review every partner personally.</b>
            </div>
          </div>

          <div className="pv-h-right">
            <div className="pv-earn" aria-hidden="true">
              <div className="pv-earn-head">
                <span className="fdot" />
                <span className="ftt">How partners earn</span>
                <span className="fping">RECURRING</span>
              </div>
              <div className="pv-earn-cap">Commission accrues month over month →</div>
              <div className="pv-spark">
                <svg viewBox="0 0 410 88" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="pv-ag" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="rgba(245,181,71,.30)" />
                      <stop offset="1" stopColor="rgba(245,181,71,0)" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0,74 L40,70 L78,66 L118,58 L158,54 L198,44 L238,40 L278,30 L318,26 L358,16 L410,10 L410,88 L0,88 Z"
                    fill="url(#pv-ag)"
                  />
                  <path
                    d="M0,74 L40,70 L78,66 L118,58 L158,54 L198,44 L238,40 L278,30 L318,26 L358,16 L410,10"
                    fill="none"
                    stroke="#F5B547"
                    strokeWidth={2}
                  />
                </svg>
              </div>
              <div className="pv-tier-h">Commission tier — grows with your book</div>
              <div className="pv-lad">
                <div className="pv-lrow dim">
                  <span className="lname">
                    Tier I<s>Starter</s>
                  </span>
                  <span className="lbar">
                    <i style={{ width: "40%" }} />
                  </span>
                  <span className="ltag">Base</span>
                </div>
                <div className="pv-lrow on">
                  <span className="lname">
                    Tier II<s>Growing</s>
                  </span>
                  <span className="lbar">
                    <i style={{ width: "66%" }} />
                  </span>
                  <span className="ltag">You</span>
                </div>
                <div className="pv-lrow dim">
                  <span className="lname">
                    Tier III<s>Established</s>
                  </span>
                  <span className="lbar">
                    <i style={{ width: "92%" }} />
                  </span>
                  <span className="ltag">Bonus</span>
                </div>
              </div>
              <div className="pv-earn-foot">
                <span>paid</span>
                <span className="lv">monthly</span>
                <span>·</span>
                <span>as long as they stay</span>
                <span className="lv">subscribed</span>
              </div>
            </div>
          </div>
        </section>

        {/* 2 · INSIDE THE PARTNER DASHBOARD */}
        <section className="pv-inside pv-section">
          <div className="pv-sec-head">
            <span className="pv-sec-eyebrow">
              <span className="d" />
              What partners see
            </span>
            <h2>
              Inside the <em>partner dashboard</em>
            </h2>
            <p className="sh-sub">
              Once you&rsquo;re approved, this is your working surface — every referral, your tier progression, and
              payout status in one place.
            </p>
          </div>
          <div className="pv-inside-grid">
            <div className="pv-dashwrap">
              <div className="pv-dashthumb" aria-hidden="true">
                <aside className="pv-dt-rail">
                  <div className="pv-dt-brand">
                    <span className="g" />
                    <span className="t">
                      Horizon
                      <s>PARTNER</s>
                    </span>
                  </div>
                  <div className="pv-dt-nav on">
                    <span className="ic">
                      <svg viewBox="0 0 24 24">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </span>
                    Referrals
                  </div>
                  <div className="pv-dt-nav">
                    <span className="ic">
                      <svg viewBox="0 0 24 24">
                        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                        <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                        <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                      </svg>
                    </span>
                    Payouts
                  </div>
                  <div className="pv-dt-nav">
                    <span className="ic">
                      <svg viewBox="0 0 24 24">
                        <path d="m3 11 18-5v12L3 14v-3z" />
                        <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
                      </svg>
                    </span>
                    Marketing
                  </div>
                  <div className="pv-dt-nav">
                    <span className="ic">
                      <svg viewBox="0 0 24 24">
                        <path d="M4 21v-7" />
                        <path d="M4 10V3" />
                        <path d="M12 21v-9" />
                        <path d="M12 8V3" />
                        <path d="M20 21v-5" />
                        <path d="M20 12V3" />
                        <path d="M1 14h6" />
                        <path d="M9 8h6" />
                        <path d="M17 16h6" />
                      </svg>
                    </span>
                    Settings
                  </div>
                </aside>
                <div className="pv-dt-main">
                  <div className="pv-dt-head">
                    <span className="dd" />
                    <span className="dtt">horizonhft.com / partner</span>
                    <span className="dtag">PREVIEW</span>
                  </div>
                  <div className="pv-dt-license">
                    <div className="pv-dt-ring">
                      <svg viewBox="0 0 56 56">
                        <circle cx="28" cy="28" r="24" stroke="rgba(245,181,71,.16)" strokeWidth={5} fill="none" />
                        <circle
                          cx="28"
                          cy="28"
                          r="24"
                          stroke="var(--pv-amber)"
                          strokeWidth={5}
                          fill="none"
                          strokeLinecap="round"
                          strokeDasharray="93.5 150.8"
                        />
                      </svg>
                      <div className="rv">
                        <b>62%</b>
                        <s>TO T·III</s>
                      </div>
                    </div>
                    <div className="pv-dt-lic">
                      <div className="ll">Partner Tier</div>
                      <div className="lt">
                        <b>Tier II</b>
                        <span className="pv-dt-badge">Active</span>
                      </div>
                      <div className="ls">
                        <b>12 referrals</b> to Tier III
                      </div>
                    </div>
                  </div>
                  <div className="pv-dt-kpis">
                    <div className="pv-dt-kpi">
                      <div className="k">
                        18 <small>+3</small>
                      </div>
                      <div className="kl">Active referrals</div>
                    </div>
                    <div className="pv-dt-kpi">
                      <div className="k">4</div>
                      <div className="kl">Pending review</div>
                    </div>
                  </div>
                  <div className="pv-dt-rows-h">Referred members</div>
                  <div className="pv-dt-rows">
                    <div className="pv-dt-row">
                      <span className="who">A</span>
                      <span className="mi">
                        <div className="nm">Aylrn</div>
                        <div className="jn">Joined Aug 2</div>
                      </span>
                      <span className="st live">Live</span>
                    </div>
                    <div className="pv-dt-row">
                      <span className="who">K</span>
                      <span className="mi">
                        <div className="nm">Kier_fx</div>
                        <div className="jn">Joined Jul 28</div>
                      </span>
                      <span className="st live">Live</span>
                    </div>
                    <div className="pv-dt-row">
                      <span className="who">M</span>
                      <span className="mi">
                        <div className="nm">m_desk</div>
                        <div className="jn">Joined Aug 19</div>
                      </span>
                      <span className="st pend">Pending</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pv-io-list">
              <div className="pv-io">
                <span className="ii">
                  <svg viewBox="0 0 24 24">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </span>
                <div>
                  <h4>Every referral, tracked</h4>
                  <p>See who joined through your link, when, and whether they&rsquo;re live or pending — no spreadsheets.</p>
                </div>
              </div>
              <div className="pv-io">
                <span className="ii">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </span>
                <div>
                  <h4>Tier progression, live</h4>
                  <p>Watch your book climb toward the next commission tier — the ring fills as your referrals grow.</p>
                </div>
              </div>
              <div className="pv-io">
                <span className="ii">
                  <svg viewBox="0 0 24 24">
                    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                    <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                  </svg>
                </span>
                <div>
                  <h4>Payout status, in the open</h4>
                  <p>Recurring commission tallied and paid monthly — track what&rsquo;s due and what&rsquo;s cleared.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3 · WHAT YOUR COMMUNITY GETS */}
        <section className="pv-props-wrap pv-section">
          <div className="pv-sec-head">
            <span className="pv-sec-eyebrow">
              <span className="d" />
              Why your traders join
            </span>
            <h2>
              What your community gets <em>when they join through you</em>
            </h2>
            <p className="sh-sub">
              Your referrals unlock a full Horizon member account — the more they get, the longer they stay, the
              longer you earn.
            </p>
          </div>
          <div className="pv-props">
            <div className="pv-prop">
              <div className="pic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M3 12h4l3-8 4 16 3-8h4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3>Low-latency feeds</h3>
              <p>Direct, colocated market-data feeds engineered for speed and consistency — the data their strategy is only as good as.</p>
            </div>
            <div className="pv-prop">
              <div className="pic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2 3 7l9 5 9-5-9-5Z" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  <path d="m3 12 9 5 9-5M3 17l9 5 9-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3>Strategies</h3>
              <p>A curated library of vetted strategies and setfiles, hosted and maintained by Horizon — deploy proven configurations, don&rsquo;t start from zero.</p>
            </div>
            <div className="pv-prop">
              <div className="pic">
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
              <h3>Community &amp; trader desk</h3>
              <p>A working community of operators — signals, discussion, and the Horizon team alongside them, not a mailing list.</p>
            </div>
            <div className="pv-prop">
              <div className="pic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="4" y="8" width="16" height="12" rx="2" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  <path
                    d="M12 8V4M8 4h8M9 14h.01M15 14h.01M2 13v2M22 13v2"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h3>AI trading agents</h3>
              <p>Per-client AI agents that watch the feed and act on their rules — an intelligent trading layer spun up on their member account.</p>
            </div>
            <div className="pv-prop">
              <div className="pic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 2l7 4v6c0 5-3 8-7 10-4-2-7-5-7-10V6l7-4z"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3>Tooling &amp; alerts</h3>
              <p>Downloads, real-time trading alerts, and education — provisioned to their account the moment they&rsquo;re in.</p>
            </div>
            <div className="pv-prop">
              <div className="pic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M8 10h.01M12 10h.01M16 10h.01" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3>Consulting</h3>
              <p>Direct setup and optimization from the Horizon HFT team — infrastructure, connectivity, and configuration, done with an expert.</p>
            </div>
          </div>
          <p className="pv-props-note">
            The stronger their account, the longer they stay — and <b>recurring commission rewards exactly that.</b>
          </p>
        </section>

        {/* 4 · APPLY + 5 · AUTH-GATE */}
        <section id="apply" className="pv-applywrap pv-section">
          <div className="pv-apply-in">
            <div className="pv-watermark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="m11 17 2 2a1 1 0 1 0 3-3" />
                <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
                <path d="m21 3 1 11h-2" />
                <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
                <path d="M3 4h8" />
              </svg>
            </div>
            <div className="pv-apply-left">
              <span className="pv-sec-eyebrow">
                <span className="d" />
                Apply
              </span>
              <h2>
                Apply to become a <em>partner</em>
              </h2>
              <p className="al-sub">
                Tell us about your community. We review every application personally and reach out to get you set up
                — usually within a couple of days.
              </p>
              <div className="pv-authgate">
                <span className="ag-ic">
                  <svg viewBox="0 0 24 24">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
                <span className="ag-tx">
                  {loggedIn ? (
                    <>
                      <b>You&rsquo;re signed in as a member.</b> Partner access is separate from your portal account
                      — you&rsquo;ll still need approval. Apply below and we&rsquo;ll review.
                    </>
                  ) : (
                    <>
                      <b>Already a Horizon member?</b> Being signed in at portal.horizonhft.com doesn&rsquo;t grant
                      partner access — partner approval is separate. Apply here and we&rsquo;ll review.
                    </>
                  )}
                </span>
              </div>
            </div>
            <div className="pv-apply-right">
              {pendingApplication ? (
                <div className="pv-pending">
                  <p>Your partner application is under review — we&rsquo;ll be in touch soon.</p>
                </div>
              ) : (
                <PartnerApplyForm />
              )}
            </div>
          </div>
        </section>

        {/* 6 · TRUST STRIP */}
        <section className="pv-trust pv-section">
          <div className="pv-trust-in">
            <div className="pv-tcell">
              <div className="tv">
                99.99<span className="u">%</span>
              </div>
              <div className="tl">Feed uptime, trailing 12mo</div>
            </div>
            <div className="pv-tcell">
              <div className="tv">
                &lt;1<span className="u">µs</span>
              </div>
              <div className="tl">Median in-venue latency</div>
            </div>
            <div className="pv-tcell">
              <div className="tv">
                3<span className="u"> DCs</span>
              </div>
              <div className="tl">LD4 · NY4 · TY3 colocation</div>
            </div>
            <div className="pv-tcell">
              <div className="tv">
                24<span className="u">/7</span>
              </div>
              <div className="tl">Trader desk &amp; live alerts</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
