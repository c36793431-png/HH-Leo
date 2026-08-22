import { signIn } from "@/lib/auth";

async function feedEmailSignIn(redirectTo: string, formData: FormData) {
  "use server";
  await signIn("resend", { email: formData.get("email"), redirectTo });
}

export function FeedLoginForm({ redirectTo }: { redirectTo: string }) {
  const emailSignInWithRedirect = feedEmailSignIn.bind(null, redirectTo);

  return (
    <form action={emailSignInWithRedirect} className="fll-form">
      <div className="fll-field">
        <label htmlFor="email">Provider email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@email.com"
          autoComplete="email"
        />
      </div>
      <button className="btn primary full" type="submit">
        Continue to provider dashboard <span className="ar">→</span>
      </button>
      <div className="fll-note">Secure magic-link sign-in — the link works once and expires.</div>
    </form>
  );
}
