import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { PublicShell } from "@/components/marketplace/public-shell";
import { EducationCatalog, type EducationLessonCard } from "@/components/education/education-catalog";
import { EDUCATION_CATEGORIES, EDUCATION_LESSONS } from "@/lib/education";
import { publicEducationCatalogue } from "@/lib/education-public";
import { withCardImages } from "@/lib/education-cards";
import { authPageHref } from "@/lib/post-auth-redirect";

export default async function EducationPage() {
  const session = await auth();

  // TODO: gate by license.tier once real license check is wired up — assume free-tier for now.
  const isPaidTier = false;

  const freeCount = EDUCATION_LESSONS.filter((l) => l.free).length;

  const page = (lessons: EducationLessonCard[]) => (
    <>
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

      <EducationCatalog lessons={withCardImages(lessons)} isPaidTier={isPaidTier} />

      <div className="foot">HORIZON HFT · customer portal</div>
    </>
  );

  // Signed out: the same list, browsable (coxwell via marcus, m62822). EducationCatalog is a client
  // component, so whatever it is given is in the page's HTML: it gets the public catalogue's card
  // fields, never the lessons themselves (intro, blocks), and lesson 11 under its public copy.
  if (!session?.user?.id) {
    return (
      <PublicShell signInHref={authPageHref("/login", "/education")} current="education">
        {page(publicEducationCatalogue().lessons)}
      </PublicShell>
    );
  }

  const switchablePanels = getReachablePanels(session.user.roles);
  const activeLicenses = await getActiveLicenseDetailsForUser(session.user.id).catch(() => []);
  const isAdmin = isAdminUser(session.user);
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      {page(EDUCATION_LESSONS)}
    </PortalShell>
  );
}
