import { TelegramLoginButton } from "./telegram-login-button";
import { EmailLoginForm } from "./email-login-form";

interface AuthCardProps {
  mode: "login" | "signup";
  botUsername: string | null;
  error?: string;
  redirectTo: string;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Sign-in link expired or invalid — please try again.",
  OAuthCallback: "Authentication provider error — please try again.",
  Verification: "That sign-in link has expired or was already used — please request a new one.",
};

export function authErrorMessage(code: string): string {
  return AUTH_ERROR_MESSAGES[code] ?? "Something went wrong signing you in — please try again.";
}

export function AuthCard({ mode, botUsername, error, redirectTo }: AuthCardProps) {
  const heading =
    mode === "login" ? "Log in to Horizon HFT" : "Create your Horizon HFT account";
  const sub =
    mode === "login"
      ? "Access your license, downloads, and community."
      : "Free to join — community, pricing, and educational content on signup.";

  return (
    <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950/80 p-8 shadow-[0_0_40px_-15px_rgba(34,211,238,0.35)]">
      <h1 className="text-xl font-semibold text-zinc-50">{heading}</h1>
      <p className="mt-1 text-sm text-zinc-400">{sub}</p>

      {error && (
        <p className="mt-4 rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-400">
          {authErrorMessage(error)}
        </p>
      )}
      <div className="mt-6 flex flex-col items-center gap-4">
        {botUsername ? (
          <TelegramLoginButton botUsername={botUsername} redirectTo={redirectTo} />
        ) : (
          <p className="text-xs text-amber-400">
            Telegram login unavailable — bot not configured.
          </p>
        )}
      </div>

      <div className="my-6 flex items-center gap-3 text-xs text-zinc-600">
        <div className="h-px flex-1 bg-zinc-800" />
        or
        <div className="h-px flex-1 bg-zinc-800" />
      </div>

      <EmailLoginForm redirectTo={redirectTo} />

      <p className="mt-6 text-center text-xs text-zinc-500">
        {mode === "login" ? (
          <>
            New here?{" "}
            <a href="/signup" className="text-cyan-400 hover:underline">
              Sign up
            </a>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <a href="/login" className="text-cyan-400 hover:underline">
              Log in
            </a>
          </>
        )}
      </p>
    </div>
  );
}
