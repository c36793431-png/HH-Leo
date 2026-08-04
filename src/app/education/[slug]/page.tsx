import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getLicenseForUser, computePortalTier } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { LessonDetail } from "@/components/education/lesson-detail";
import { getEducationLesson } from "@/lib/education";

export default async function EducationLessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lesson = getEducationLesson(slug);
  if (!lesson) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const licenseDetail = await getLicenseForUser(session.user.id).catch(() => null);
  const isAdmin = isAdminUser(session.user);
  const tier = computePortalTier(isAdmin, licenseDetail);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  // TODO: gate by license.tier once real license check is wired up — assume free-tier for now.
  const isPaidTier = false;

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
      <LessonDetail lesson={lesson} isPaidTier={isPaidTier} />
      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
