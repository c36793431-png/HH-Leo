import { signIn } from "@/lib/auth";

async function partnerEmailSignIn(redirectTo: string, formData: FormData) {
  "use server";
  await signIn("resend", { email: formData.get("email"), redirectTo });
}

export function PartnerLoginForm({ redirectTo }: { redirectTo: string }) {
  const emailSignInWithRedirect = partnerEmailSignIn.bind(null, redirectTo);

  return (
    <form action={emailSignInWithRedirect} className="pvl-form">
      <div className="pvl-field">
        <label htmlFor="email">Partner email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@email.com"
          autoComplete="email"
        />
      </div>
      <button className="pv-btn amber full" type="submit">
        Continue to partner dashboard <span className="ar">→</span>
      </button>
      <div className="pvl-note">Secure magic-link sign-in — the link works once and expires.</div>
    </form>
  );
}
