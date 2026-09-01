import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { LessonDetail } from "@/components/education/lesson-detail";
import { getEducationLesson } from "@/lib/education";

export default async function EducationLessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lesson = getEducationLesson(slug);
  if (!lesson) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect("/login");
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
