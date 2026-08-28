import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";

/** Shared signed-in/signed-out nav chip for feed.horizonhft.com pages. Extracted so the
 * session check lives in one place -- feed/page.tsx and feed/providers/apply/page.tsx were
 * built independently and had drifted (bus thread feed-provider-apply-page-logo-2026-08-25:
 * the apply page's header hand-rolled a static "Already a provider? Log in" link with no
 * auth() call at all, unlike the landing page). Both pages keep their own CSS class names via
 * props so this doesn't force a visual rework -- only the session-check logic is shared. */
export async function FeedAuthNavStatus({
  signedInClassName,
  avatarClassName,
  signOutClassName,
  signedOutHref,
  signedOutClassName,
  signedOutContent,
  redirectTo = "/",
}: {
  signedInClassName: string;
  avatarClassName: string;
  signOutClassName: string;
  signedOutHref?: string;
  signedOutClassName?: string;
  signedOutContent?: React.ReactNode;
  redirectTo?: string;
}) {
  const session = await auth();
  const user = session?.user ?? null;
  const loggedIn = Boolean(user?.id);
  const memberLabel = user?.name?.trim() || user?.email?.trim() || "member";
  const memberInitial = memberLabel.charAt(0).toUpperCase();

  if (!loggedIn) {
    if (!signedOutHref) return null;
    return (
      <a className={signedOutClassName} href={signedOutHref}>
        {signedOutContent}
      </a>
    );
  }

  return (
    <span className={signedInClassName}>
      <span className={avatarClassName}>{memberInitial}</span>Signed in as <b>{memberLabel}</b>
      <SignOutButton className={signOutClassName} redirectTo={redirectTo} />
    </span>
  );
}
