import Image from "next/image";
import Link from "next/link";
import { ProviderApplyForm } from "@/components/feed/provider-apply-form";
import { FeedAuthNavStatus } from "@/components/feed/feed-auth-nav-status";
import "./feed-apply.css";

/** Public feed-provider application (mounted at /providers/apply on feed.horizonhft.com,
 * proxy.ts rewrites that to /feed/providers/apply -- see the rewrite's passthrough list) --
 * bus thread leo-feed-login-and-apply-implementation-2026-08-22, mockup
 * mockups/horizon-feed-provider/feed-apply.html. No auth/session required, mirrors
 * app/partner/apply's zero-auth-check shape. Writes a provider_applications row (0059) and
 * fires an admin Telegram notify (notifyProviderApplicationSubmitted) -- the admin review
 * queue itself (approve -> pre-fill register-provider.html) is an explicit follow-up, not
 * built in this pass (see feed-apply-spec.md's admin-side delta note).
 *
 * Deviations from the mockup (documented, all intentional):
 *  - Protocol/region chip multiselects are plain checkbox groups styled as chips (no client
 *    JS chip-toggle widget) -- same visual result, less machinery.
 *  - §4 only carries the free-text "notes" field -- "how did you hear about us" / referral
 *    code have no backing column and weren't in this task's scope.
 *  - Mockup's "Save & finish later" ghost button dropped -- there's no draft-save backend.
 *  - The context rail (steps + trust tiles) stays visible after a successful submit instead
 *    of being hidden like the mockup's body.state-success rule -- simpler to keep the whole
 *    rail server-rendered outside the form/success toggle, and it's still useful info.
 *
 * Nav auth status (feed-provider-apply-page-logo-2026-08-25): shares FeedAuthNavStatus with
 * feed/page.tsx so a signed-in visitor sees the same "Signed in as" chip here as on the
 * landing page, instead of this page's previous static "Already a provider? Log in" link,
 * which showed unconditionally regardless of session. */
export default async function ProviderApplyPage() {
  return (
    <div className="feed-apply-v1">
      <div className="fap-wrap">
        <nav className="fap-nav">
          <Link className="fap-brand" href="/">
            <span className="fap-glyph">
              <Image src="/logo-feed.png" alt="Horizon HFT" width={42} height={42} priority />
            </span>
            <span className="fap-txt">
              HORIZON
              <small>HFT · FEED NETWORK</small>
            </span>
          </Link>
          <span className="fap-sp" />
          <FeedAuthNavStatus
            signedInClassName="fap-signedin"
            avatarClassName="fap-av"
            signOutClassName="fap-nav-login"
            signedOutHref="/login"
            signedOutClassName="fap-nav-login"
            redirectTo="/providers/apply"
            signedOutContent={
              <>
                <svg
                  className="ic"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
                Already a provider? Log in
              </>
            }
          />
        </nav>

        <main className="fap-applywrap">
          <div className="fap-head">
            <span className="fap-pb-seal" aria-hidden="true">
              <Image src="/logo-feed.png" alt="" width={28} height={28} />
            </span>
            <div className="fap-eyebrow">
              <span className="dot" />
              Horizon Feed Network · Apply
            </div>
            <h1>
              Publish your feed on <em>Horizon</em>.
            </h1>
            <p className="lead">
              Tell us about your market-data feed and how to reach you. Every application is{" "}
              <b>reviewed by our team</b> — once approved, we verify your endpoint, bind your tiers, and you go
              live to institutional and retail subscribers.
            </p>
          </div>

          <aside className="fap-rail">
            <div className="card">
              <h3>What happens next</h3>
              <ul className="fap-steps">
                <li>
                  <span className="sn">1</span>
                  <div className="st">
                    <b>We review your application</b>
                    <span>Our team checks fit, coverage, and data quality. No feed goes live unreviewed.</span>
                  </div>
                </li>
                <li>
                  <span className="sn">2</span>
                  <div className="st">
                    <b>We verify your endpoint</b>
                    <span>We connect to your feed and confirm protocol, latency, and integrity before anything ships.</span>
                  </div>
                </li>
                <li>
                  <span className="sn">3</span>
                  <div className="st">
                    <b>We bind your tiers</b>
                    <span>Together we set the tiers you&apos;ll offer and your revenue share — then your workspace opens.</span>
                  </div>
                </li>
                <li>
                  <span className="sn">4</span>
                  <div className="st">
                    <b>You go live</b>
                    <span>Subscribers can find and connect to your feed across LD4, NY4, and TY3.</span>
                  </div>
                </li>
              </ul>
            </div>
            <div className="card">
              <h3>The network</h3>
              <div className="trust">
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
            <div className="reassure">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>
                Your connection details are used only to verify your feed. We never publish them, and no tier goes
                live until you and our team agree the terms.
              </span>
            </div>
          </aside>

          <ProviderApplyForm />
        </main>

        <footer className="fap-foot">
          <span className="fbrand">HORIZON HFT · FEED NETWORK · © 2026</span>
          <span className="fsp" />
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a className="fpart" href="/login">
            Provider login
          </a>
        </footer>
      </div>
    </div>
  );
}
