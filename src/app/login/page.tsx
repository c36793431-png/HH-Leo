import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getBotUsername } from "@/lib/telegram-bot";
import { AuthCard } from "@/components/auth-card";
import { Logo } from "@/components/logo";
import { PartnerLoginView } from "@/components/partner/partner-login-view";
import { FeedLoginView } from "@/components/feed/feed-login-view";
import { getPostAuthRedirect } from "@/lib/post-auth-redirect";

// Kept in sync with proxy.ts / post-auth-redirect.ts / dashboard/layout.tsx's own
// PARTNER_HOST/FEED_HOST checks (bus threads leo-partner-surface-p1-implementation-2026-08-22
// and leo-feed-provider-login-2026-08-22).
const PARTNER_HOST = "partner.horizonhft.com";
const FEED_HOST = "feed.horizonhft.com";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const host = (await headers()).get("host");
  const isPartnerHost = host === PARTNER_HOST || (host?.startsWith(`${PARTNER_HOST}:`) ?? false);
  const isFeedHost = host === FEED_HOST || (host?.startsWith(`${FEED_HOST}:`) ?? false);
  const redirectTo = getPostAuthRedirect(host);

  const session = await auth();
  if (session) redirect(redirectTo);

  const { error } = await searchParams;

  if (isPartnerHost) {
    return <PartnerLoginView error={error} redirectTo={redirectTo} />;
  }

  if (isFeedHost) {
    return <FeedLoginView error={error} redirectTo={redirectTo} />;
  }

  const botUsername = await getBotUsername();

  return (
    <>
      <header className="flex items-center px-6 py-5">
        <Logo size="nav" />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 pb-16">
        <AuthCard mode="login" botUsername={botUsername} error={error} redirectTo={redirectTo} />
      </main>
    </>
  );
}
