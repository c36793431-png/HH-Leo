import Link from "next/link";
import { authErrorMessage } from "@/components/auth-card";
import { FeedLoginForm } from "@/components/feed/feed-login-form";
import "@/app/login/feed-login.css";

/** Amber split-panel /login rendered on the feed.horizonhft.com host (portal and partner
 * hosts keep their own login views) -- bus thread
 * leo-feed-login-and-apply-implementation-2026-08-22, mockup
 * mockups/horizon-feed-provider/feed-login.html. Replaces the earlier single-card cyan/teal
 * version (b835279) now that Iris shipped a provider-specific split-card mockup, sibling of
 * PartnerLoginView's .partner-v3 shape. Reuses feed-login.css's .feed-auth-v1/fa-* scope --
 * CYAN stays the brand-glyph color, everything else is amber per the mockup's color grammar
 * (feed providers ARE partners). Providers can now self-apply via /providers/apply (this
 * pass's other half), so the old "contact Horizon on Telegram" pointer is replaced by the
 * mockup's "Apply to publish your feed" link. */
export function FeedLoginView({ error, redirectTo }: { error?: string; redirectTo: string }) {
  return (
    <div className="feed-auth-v1">
      <div className="fa-wrap">
        <nav className="fa-nav">
          <Link className="fa-brand" href="/">
            <span className="fa-glyph">
              <svg viewBox="0 0 48 48" fill="none" aria-label="Horizon HFT">
                <g stroke="#041A1E" strokeWidth={3.2} strokeLinecap="round">
                  <line x1="16" y1="13" x2="16" y2="35" />
                  <line x1="32" y1="13" x2="32" y2="35" />
                  <line x1="13.5" y1="24" x2="34.5" y2="24" />
                </g>
                <path d="M19 24a5 5 0 0 1 10 0" fill="none" stroke="#041A1E" strokeWidth={2.4} strokeLinecap="round" />
              </svg>
            </span>
            <span className="fa-txt">
              HORIZON
              <small>HFT · FEED NETWORK</small>
            </span>
          </Link>
          <span className="fa-sp" />
          <a className="fa-nav-apply" href="/providers/apply">
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
            <span className="lbl-full">Not a provider yet? Apply</span>
            <span className="lbl-short">Apply</span>
          </a>
        </nav>

        <main className="fa-authwrap">
          <div className="fa-authcard">
            <section className="fa-auth-brand">
              <div className="fa-ab-watermark" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m11 17 2 2a1 1 0 1 0 3-3" />
                  <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
                  <path d="m21 3 1 11h-2" />
                  <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
                  <path d="M3 4h8" />
                </svg>
              </div>
              <div className="fa-ab-in">
                <span className="fa-pb-seal" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="m11 17 2 2a1 1 0 1 0 3-3" />
                    <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
                    <path d="m21 3 1 11h-2" />
                    <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
                    <path d="M3 4h8" />
                  </svg>
                </span>
                <div className="fa-eyebrow">
                  <span className="dot" />
                  Horizon Feed Network
                </div>
                <h1>
                  Welcome back,
                  <br />
                  <em>provider.</em>
                </h1>
                <p className="lead">
                  Sign in to your feed provider workspace — subscribers, feed health, and your revenue share, in
                  one place.
                </p>
                <ul className="fa-ab-list">
                  <li>
                    <span className="ii">
                      <svg viewBox="0 0 24 24">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </span>
                    <span>
                      Your <b>subscribers</b>, tracked live by tier
                    </span>
                  </li>
                  <li>
                    <span className="ii">
                      <svg viewBox="0 0 24 24">
                        <path d="M3 3v18h18" />
                        <path d="m7 15 3-4 3 2 4-6" />
                      </svg>
                    </span>
                    <span>
                      Your <b>feed health</b> — uptime, latency, gaps
                    </span>
                  </li>
                  <li className="earn">
                    <span className="ii">
                      <svg viewBox="0 0 24 24">
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                      </svg>
                    </span>
                    <span>
                      Your <b>revenue share</b>, cleared each cycle
                    </span>
                  </li>
                </ul>
                <div className="fa-ab-trust">
                  <div className="tc">
                    <div className="tv">
                      99.99<span className="u">%</span>
                    </div>
                    <div className="tl">Feed uptime</div>
                  </div>
                  <div className="tc">
                    <div className="tv">
                      &lt;1<span className="u">µs</span>
                    </div>
                    <div className="tl">Median latency</div>
                  </div>
                  <div className="tc">
                    <div className="tv">
                      3<span className="u"> DCs</span>
                    </div>
                    <div className="tl">LD4·NY4·TY3</div>
                  </div>
                  <div className="tc earn">
                    <div className="tv">
                      50<span className="u">/50</span>
                    </div>
                    <div className="tl">Revenue split</div>
                  </div>
                </div>
              </div>
            </section>

            <section className="fa-auth-form">
              <div className="fa-af-form">
                <div className="fa-af-head">
                  <div className="k">
                    <span className="d" />
                    Feed provider login
                  </div>
                  <h2>Log in to your feed provider workspace</h2>
                  <p className="sub">
                    Access your subscribers, feed health, and revenue share. We&apos;ll email you a secure sign-in
                    link — no password to remember.
                  </p>
                </div>

                {error && <p className="fa-af-error">{authErrorMessage(error)}</p>}

                <FeedLoginForm redirectTo={redirectTo} />

                <div className="fa-af-div">OR</div>
                <div className="fa-af-apply">
                  Not a provider yet?{" "}
                  <a href="/providers/apply">
                    Apply to publish your feed <span className="ar">→</span>
                  </a>
                </div>
                <div className="fa-af-help">
                  Looking to <a href="https://portal.horizonhft.com/login">subscribe to a feed</a>? Sign in at the
                  portal.
                </div>
              </div>
            </section>
          </div>
        </main>

        <footer className="fa-foot">
          <span className="fbrand">HORIZON HFT · FEED NETWORK · © 2026</span>
          <span className="fsp" />
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a className="fpart" href="/providers/apply">
            Publish your feed
          </a>
        </footer>
      </div>
    </div>
  );
}
