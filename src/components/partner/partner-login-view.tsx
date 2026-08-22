import Image from "next/image";
import Link from "next/link";
import { authErrorMessage } from "@/components/auth-card";
import { PartnerLoginForm } from "@/components/partner/partner-login-form";
import "@/app/partner/partner-landing.css";
import "@/app/login/partner-login.css";

/** Amber-branded /login rendered on the partner.horizonhft.com host (portal host keeps the
 * cyan AuthCard) -- bus thread leo-partner-surface-p1-implementation-2026-08-22, mockup
 * mockups/horizon-referral-partner/partner-login.html. Reuses partner-landing.css's
 * .partner-v3/.pv-nav/.pv-btn tokens for identical chrome to the partner landing page. */
export function PartnerLoginView({ error, redirectTo }: { error?: string; redirectTo: string }) {
  return (
    <div className="partner-v3">
      <div className="pv-backdrop" aria-hidden="true">
        <div className="glow" />
        <div className="grid" />
      </div>
      <div className="pv-wrap">
        <nav className="pv-nav">
          <Link className="pv-brand" href="/">
            <span className="glyph">
              <Image src="/brand/horizon-logo-partner.png" alt="Horizon HFT — Partner Program" width={42} height={42} priority />
            </span>
            <span className="txt">
              HORIZON
              <small>HFT · PARTNER PROGRAM</small>
            </span>
          </Link>
          <span className="pv-nav-links">
            <a className="pv-partner-link" href="/partner/apply">
              Not a partner yet? Apply
            </a>
          </span>
        </nav>

        <main className="pvl-authwrap">
          <div className="pvl-card">
            <section className="pvl-brand">
              <span className="pvl-seal" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="m11 17 2 2a1 1 0 1 0 3-3" />
                  <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
                  <path d="m21 3 1 11h-2" />
                  <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
                  <path d="M3 4h8" />
                </svg>
              </span>
              <div className="pvl-eyebrow">
                <span className="dot" />
                Horizon Partner Program
              </div>
              <h1>
                Welcome back,
                <br />
                <em>partner.</em>
              </h1>
              <p className="lead">
                Sign in to your partner workspace — everything you&apos;ve built with Horizon HFT, in one place.
              </p>
              <ul className="pvl-list">
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
                    Your <b>referrals</b>, tracked live
                  </span>
                </li>
                <li>
                  <span className="ii">
                    <svg viewBox="0 0 24 24">
                      <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </span>
                  <span>
                    Your <b>tier progress</b> toward the next bonus
                  </span>
                </li>
                <li>
                  <span className="ii">
                    <svg viewBox="0 0 24 24">
                      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                    </svg>
                  </span>
                  <span>
                    Your <b>payouts</b>, tallied and cleared
                  </span>
                </li>
              </ul>
              <div className="pvl-trust">
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
                <div className="tc">
                  <div className="tv">
                    24<span className="u">/7</span>
                  </div>
                  <div className="tl">Trader desk</div>
                </div>
              </div>
            </section>

            <section className="pvl-formcard">
              <div className="pvl-head">
                <div className="k">
                  <span className="d" />
                  Partner login
                </div>
                <h2>Log in to your partner dashboard</h2>
                <p className="sub">
                  Access your referrals, tier progress, and payouts. We&apos;ll email you a secure sign-in link —
                  no password to remember.
                </p>
              </div>

              {error && <p className="pvl-error">{authErrorMessage(error)}</p>}

              <PartnerLoginForm redirectTo={redirectTo} />

              <div className="pvl-div">OR</div>
              <div className="pvl-apply">
                Not a partner yet? <a href="/partner/apply">Apply to the program →</a>
              </div>
              <div className="pvl-help">
                Looking for your <a href="https://portal.horizonhft.com/login">member account</a>? Sign in at
                the portal.
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
