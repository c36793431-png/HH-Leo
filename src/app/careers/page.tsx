import Image from "next/image";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { Logo } from "@/components/logo";
import { ApplicationForm } from "@/components/careers/application-form";

function CareersContent() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <div className="text-xs font-semibold tracking-[0.2em] text-cyan-400">CAREERS</div>
        <h1 className="mt-2 text-3xl font-bold text-zinc-50">Work with Horizon HFT</h1>
        <p className="mt-3 text-sm text-zinc-400">
          We hire opinionated builders for project-based work. If you&apos;re a fit,{" "}
          <a href="#apply-form" className="text-cyan-400 hover:underline">
            apply below
          </a>{" "}
          with a short intro + CV.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-cyan-500/20 bg-[#0b0e16]">
        <Image
          src="/careers/csharp-dev.png"
          alt="C# Developer Opportunity — Horizon HFT"
          width={1024}
          height={1024}
          className="w-full"
        />
        <div className="p-6 sm:p-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-zinc-50">C# Developer Opportunity</h2>
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
              Project-based · Remote
            </span>
          </div>

          <dl className="mb-6 grid grid-cols-1 gap-x-6 gap-y-2 text-sm text-zinc-300 sm:grid-cols-2">
            <div className="flex justify-between gap-4 sm:block">
              <dt className="text-zinc-500">Compensation</dt>
              <dd className="font-medium text-zinc-100">$3,000 / project</dd>
            </div>
            <div className="flex justify-between gap-4 sm:block">
              <dt className="text-zinc-500">Experience</dt>
              <dd className="font-medium text-zinc-100">10-15 years C#</dd>
            </div>
            <div className="flex justify-between gap-4 sm:block">
              <dt className="text-zinc-500">Language</dt>
              <dd className="font-medium text-zinc-100">Native English (C1-C2)</dd>
            </div>
            <div className="flex justify-between gap-4 sm:block">
              <dt className="text-zinc-500">Timezone</dt>
              <dd className="font-medium text-zinc-100">Flexible</dd>
            </div>
          </dl>

          <a
            href="#apply-form"
            className="inline-flex items-center justify-center rounded-md bg-cyan-500/90 px-5 py-2.5 text-sm font-medium text-black hover:bg-cyan-400"
          >
            Apply below ↓
          </a>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-cyan-500/10 bg-[#0b0e16]/60 p-5">
        <h3 className="text-sm font-medium text-zinc-300">Want to join the Horizon team?</h3>
        <p className="mt-1.5 text-xs text-zinc-500">
          Send us your info and CV — we&apos;re always open to talking with strong builders.
        </p>
        <p className="mt-3 text-xs text-zinc-500">
          <a href="#apply-form" className="text-cyan-400 hover:underline">
            Apply below →
          </a>
        </p>
      </div>

      <div className="mt-6">
        <ApplicationForm />
      </div>
    </div>
  );
}

export default async function CareersPage() {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <>
        <header className="flex items-center px-6 py-5">
          <Logo size="nav" />
        </header>
        <main className="flex-1 px-4 pb-20 pt-6">
          <CareersContent />
        </main>
      </>
    );
  }

  const activeLicenses = await getActiveLicenseDetailsForUser(session.user.id).catch(() => []);
  const isAdmin = isAdminUser(session.user);
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";
  const switchablePanels = getReachablePanels(session.user.roles);

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      <CareersContent />
      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
