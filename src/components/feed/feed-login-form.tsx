import { signIn } from "@/lib/auth";

async function feedEmailSignIn(redirectTo: string, formData: FormData) {
  "use server";
  await signIn("resend", { email: formData.get("email"), redirectTo });
}

/** Email magic-link form for the feed.horizonhft.com login card (see FeedLoginView). Mirrors
 * PartnerLoginForm's signIn("resend") mechanism exactly -- NextAuth redirects server-side to
 * its own verify-request page on submit, so there's no in-page "check your email" state to
 * build here (same deviation documented in app/login/partner-login.css). */
export function FeedLoginForm({ redirectTo }: { redirectTo: string }) {
  const emailSignInWithRedirect = feedEmailSignIn.bind(null, redirectTo);

  return (
    <form action={emailSignInWithRedirect}>
      <div className="fa-field">
        <label htmlFor="email">Provider email</label>
        <div className="fa-ipwrap">
          <span className="lic">
            <svg viewBox="0 0 24 24">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </span>
          <input
            className="fa-ip"
            id="email"
            name="email"
            type="email"
            required
            placeholder="ops@your-feed.io"
            autoComplete="email"
          />
        </div>
      </div>
      <button className="fa-btn amber" type="submit">
        Continue to provider dashboard <span className="ar">→</span>
      </button>
      <div className="fa-af-note">
        <span className="ic">
          <svg viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </span>{" "}
        Secure magic-link sign-in — the link works once and expires.
      </div>
    </form>
  );
}
