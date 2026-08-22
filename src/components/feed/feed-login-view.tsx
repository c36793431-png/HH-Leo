import { authErrorMessage } from "@/components/auth-card";
import { FeedLoginForm } from "@/components/feed/feed-login-form";
import "@/app/feed/dashboard/feed-dashboard.css";
import "@/app/login/feed-login.css";

/** Cyan/teal-branded /login rendered on the feed.horizonhft.com host (portal and partner
 * hosts keep their own login views) -- bus thread leo-feed-provider-login-2026-08-22.
 * Reuses feed-dashboard.css's .feed-provider-v1 scope and --pfp-* tokens for chrome
 * parity with the provider panel. Providers are admin-onboarded (see
 * src/app/feed/page.tsx), not self-signup, so this omits a "sign up" link entirely in
 * favor of a contact-Horizon pointer. */
export function FeedLoginView({ error, redirectTo }: { error?: string; redirectTo: string }) {
  return (
    <div className="feed-provider-v1">
      <div className="fll-wrap">
        <div className="fll-card">
          <span className="fll-seal" aria-hidden="true">
            H
          </span>
          <div className="fll-eyebrow">
            <span className="dot" />
            Feed Provider Login
          </div>
          <h1>Log in to Feed Providers</h1>
          <p className="fll-sub">Manage your feeds, subscribers, and revenue.</p>

          {error && <p className="fll-error">{authErrorMessage(error)}</p>}

          <FeedLoginForm redirectTo={redirectTo} />

          <div className="fll-div">OR</div>
          <div className="fll-contact">
            Not onboarded yet?{" "}
            <a href="https://t.me/coxwell2" target="_blank" rel="noopener noreferrer">
              Contact Horizon to become a feed provider →
            </a>
          </div>
          <div className="fll-help">
            Looking for your <a href="https://portal.horizonhft.com/login">member account</a>? Sign in at
            the portal.
          </div>
        </div>
      </div>
    </div>
  );
}
