import { notFound, permanentRedirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { PublicShell } from "@/components/marketplace/public-shell";
import { LessonDetail, LessonPreview } from "@/components/education/lesson-detail";
import { getEducationLesson, lessonHref, renamedLessonSlug } from "@/lib/education";
import { signedOutLesson } from "@/lib/education-signed-out";
import { authPageHref } from "@/lib/post-auth-redirect";

export default async function EducationLessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Before the auth check, so a signed-out bookmark of the old URL lands on the new one after sign-in.
  const renamed = renamedLessonSlug(slug);
  const lesson = getEducationLesson(renamed ?? slug);
  if (!lesson) notFound();
  if (renamed) permanentRedirect(lessonHref(lesson));

  const session = await auth();
  // Signed out: the first part of the lesson and a sign-in card that returns here (coxwell via
  // marcus, m62822). Built from the catalogue object, not the URL param: an unknown slug has
  // already 404'd above.
  if (!session?.user?.id) {
    const signInHref = authPageHref("/login", lessonHref(lesson));
    return (
      <PublicShell signInHref={signInHref}>
        <LessonPreview
          lesson={signedOutLesson(lesson)}
          signInHref={signInHref}
          signUpHref={authPageHref("/signup", lessonHref(lesson))}
        />
        <div className="foot">HORIZON HFT · customer portal</div>
      </PublicShell>
    );
  }
  const switchablePanels = getReachablePanels(session.user.roles);

  const activeLicenses = await getActiveLicenseDetailsForUser(session.user.id).catch(() => []);
  const isAdmin = isAdminUser(session.user);
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  // TODO: gate by license.tier once real license check is wired up — assume free-tier for now.
  const isPaidTier = false;

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      <LessonDetail lesson={lesson} isPaidTier={isPaidTier} />
      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
