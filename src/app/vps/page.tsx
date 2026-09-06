import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses, computeUserActiveFeeds } from "@/lib/licenses";
import type { FeedType } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { Logo } from "@/components/logo";
import { VPS_LOCATIONS, VPS_PLANS } from "@/lib/vps-locations";

const BULLETS = [
  "Reliable trading infrastructure built for uptime, not just cheap disk",
  "Low-latency routes to major broker endpoints",
  "EA and arbitrage-software capable — no odd process restrictions",
  "Better SLA than the cheap anonymous shops that get DDoS-ed or vanish overnight",
];

function VpsContent({ activeFeeds = [] }: { activeFeeds?: FeedType[] }) {
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

        <div className="mb-6">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Locations</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {VPS_LOCATIONS.map((loc) => {
              const hasMatchingFeed = loc.feedType && activeFeeds.includes(loc.feedType);
              return (
                <div
                  key={loc.city}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    loc.live ? "border-zinc-800 bg-zinc-900/40 text-zinc-300" : "border-zinc-800/60 bg-zinc-900/20 text-zinc-500"
                  }`}
                >
                  <div className="font-medium text-zinc-100">
                    {loc.city}, {loc.country}
                    {!loc.live && <span className="ml-2 text-[10px] uppercase tracking-wide text-zinc-500">Coming soon</span>}
                  </div>
                  <div className="text-xs text-zinc-400">
                    {loc.descriptor}
                    {loc.datacenter ? ` · ${loc.datacenter}` : ""}
                  </div>
                  {hasMatchingFeed && (
                    <div className="mt-1 text-xs text-cyan-400">Same city as the feed you already have.</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <p className="mb-6 text-xs text-zinc-400">
          Every plan: AMD Ryzen 9 9950X (Zen 5, 5.7 GHz boost), DDR5, NVMe SSD · Windows Server 2022 / Ubuntu 24.04 · 3
          Gbps network · full administrator access · dedicated IPv4 · instant deployment · cancel anytime · 7-day
          refund · 3-day free trial on any plan.
        </p>

        <div className="mb-6 overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-300">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-zinc-500">
                <th className="pb-2 pr-4 font-medium">Plan</th>
                <th className="pb-2 pr-4 font-medium">Price</th>
                <th className="pb-2 pr-4 font-medium">For</th>
                <th className="pb-2 pr-4 font-medium">vCores</th>
                <th className="pb-2 pr-4 font-medium">RAM</th>
                <th className="pb-2 font-medium">Storage</th>
              </tr>
            </thead>
            <tbody>
              {VPS_PLANS.map((plan) => (
                <tr key={plan.name} className="border-t border-zinc-800">
                  <td className="py-2 pr-4">
                    {plan.name}
                    {plan.mostPopular && (
                      <span className="ml-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-300">
                        Most popular
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">${plan.priceUsdPerMonth}/mo</td>
                  <td className="py-2 pr-4">{plan.forDescription}</td>
                  <td className="py-2 pr-4">{plan.vCores}</td>
                  <td className="py-2 pr-4">{plan.ramGb} GB</td>
                  <td className="py-2">{plan.storageGb} GB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

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
  const activeFeeds = await computeUserActiveFeeds(session.user.id).catch(() => []);

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      <VpsContent activeFeeds={activeFeeds} />
      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
