import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getBotUsername } from "@/lib/telegram-bot";
import { AuthCard } from "@/components/auth-card";
import { Logo } from "@/components/logo";
import { getPostAuthRedirect, safeCallbackPath } from "@/lib/post-auth-redirect";
import { MAIN_SITE_URL } from "@/lib/main-site";

// Kept in sync with login/page.tsx's own PARTNER_HOST/FEED_HOST checks.
const PARTNER_HOST = "partner.horizonhft.com";
const FEED_HOST = "feed.horizonhft.com";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string | string[] }>;
}) {
  const host = (await headers()).get("host");
  const isPartnerHost = host === PARTNER_HOST || (host?.startsWith(`${PARTNER_HOST}:`) ?? false);
  const isFeedHost = host === FEED_HOST || (host?.startsWith(`${FEED_HOST}:`) ?? false);
  const isPortalHost = !isPartnerHost && !isFeedHost;
  const { error, callbackUrl } = await searchParams;
  // Allowlisted marketplace pages only; anything else is the host's usual destination.
  const callbackPath = safeCallbackPath(callbackUrl, host);
  const redirectTo = callbackPath ?? getPostAuthRedirect(host);

  const session = await auth();
  if (session) redirect(redirectTo);

  const botUsername = await getBotUsername();

  return (
    <>
      {/* The way back to the main site, as on the portal's /login (marcus m58402). The partner and
          feed hosts proxy /signup through to this same page, so they keep the bare logo. */}
      <header className="flex items-center px-6 py-5">
        {isPortalHost ? (
          <>
            <Logo size="nav" href={MAIN_SITE_URL} />
            <a href={MAIN_SITE_URL} className="ml-auto whitespace-nowrap text-sm text-zinc-400 hover:text-zinc-200">
              ← horizonhft.com
            </a>
          </>
        ) : (
          <Logo size="nav" />
        )}
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 pb-16">
        <AuthCard mode="signup" botUsername={botUsername} error={error} redirectTo={redirectTo} callbackPath={callbackPath} />
      </main>
    </>
  );
}
