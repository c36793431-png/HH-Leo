import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getBotUsername } from "@/lib/telegram-bot";
import { AuthCard } from "@/components/auth-card";
import { Logo } from "@/components/logo";
import { getPostAuthRedirect, safeCallbackPath } from "@/lib/post-auth-redirect";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string | string[] }>;
}) {
  const host = (await headers()).get("host");
  const { error, callbackUrl } = await searchParams;
  // Allowlisted marketplace pages only; anything else is the host's usual destination.
  const callbackPath = safeCallbackPath(callbackUrl, host);
  const redirectTo = callbackPath ?? getPostAuthRedirect(host);

  const session = await auth();
  if (session) redirect(redirectTo);

  const botUsername = await getBotUsername();

  return (
    <>
      <header className="flex items-center px-6 py-5">
        <Logo size="nav" />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 pb-16">
        <AuthCard mode="signup" botUsername={botUsername} error={error} redirectTo={redirectTo} callbackPath={callbackPath} />
      </main>
    </>
  );
}
