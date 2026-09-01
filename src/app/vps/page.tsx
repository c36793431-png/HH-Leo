import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { Logo } from "@/components/logo";

const BULLETS = [
  "Reliable trading infrastructure built for uptime, not just cheap disk",
  "Low-latency routes to major broker endpoints",
  "EA and arbitrage-software capable — no odd process restrictions",
  "Better SLA than the cheap anonymous shops that get DDoS-ed or vanish overnight",
];

function VpsContent() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <div className="text-xs font-semibold tracking-[0.2em] text-cyan-400">INFRASTRUCTURE</div>
        <h1 className="mt-2 text-3xl font-bold text-zinc-50">Recommended VPS for HFT &amp; algo trading</h1>
      </div>

      <div className="rounded-xl border border-cyan-500/20 bg-[#0b0e16] p-6 sm:p-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-zinc-50">Tradox VPS</h2>
          <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
            Partner
          </span>
        </div>

        <ul className="mb-6 space-y-2 text-sm text-zinc-300">
          {BULLETS.map((b) => (
            <li key={b} className="flex gap-2">
              <span className="text-cyan-400">•</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <p className="mb-6 text-xs text-zinc-500">
          Coxwell has referred clients here since 2026-07 — the link below is our partner link.
        </p>

        <a
          href="https://app.tradoxvps.com/aff.php?aff=33"
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="inline-flex items-center justify-center rounded-md bg-cyan-500/90 px-5 py-2.5 text-sm font-medium text-black hover:bg-cyan-400"
        >
          Get a Tradox VPS →
        </a>

        <p className="mt-4 text-xs text-zinc-500">
          Need help migrating? Message{" "}
          <a href="https://t.me/coxwell2" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">
            @coxwell2
          </a>{" "}
          on Telegram — free for Horizon Traders.
        </p>
      </div>
    </div>
  );
}

export default async function VpsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <>
        <header className="flex items-center px-6 py-5">
          <Logo size="nav" />
        </header>
        <main className="flex-1 px-4 pb-20 pt-6">
          <VpsContent />
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
      <VpsContent />
      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
