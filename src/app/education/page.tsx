import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getLicenseForUser, computePortalTier } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { EducationCatalog } from "@/components/education/education-catalog";
import { EDUCATION_CATEGORIES, EDUCATION_LESSONS } from "@/lib/education";

export default async function EducationPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const licenseDetail = await getLicenseForUser(session.user.id).catch(() => null);
  const isAdmin = isAdminUser(session.user);
  const tier = computePortalTier(isAdmin, licenseDetail);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  // TODO: gate by license.tier once real license check is wired up — assume free-tier for now.
  const isPaidTier = false;

  const freeCount = EDUCATION_LESSONS.filter((l) => l.free).length;

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
      <div className="edu-hero">
        <div className="eyebrow">Horizon Academy</div>
        <h2>Learn to trade with Horizon HFT</h2>
        <p>
          Step-by-step lessons on setup, broker connections, strategy design, and troubleshooting — from your first
          order to advanced execution tactics.
        </p>
        <div className="edu-stats">
          <div className="stat">
            <b>{EDUCATION_LESSONS.length}</b>
            <span>Lessons</span>
          </div>
          <div className="stat">
            <b>{EDUCATION_CATEGORIES.length}</b>
            <span>Categories</span>
          </div>
          <div className="stat">
            <b>{freeCount}</b>
            <span>Free intro</span>
          </div>
        </div>
      </div>

      <EducationCatalog lessons={EDUCATION_LESSONS} isPaidTier={isPaidTier} />

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
