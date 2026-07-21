import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getActiveLicenseForUser } from "@/lib/licenses";
import { getPortalConfig } from "@/lib/portal-config";
import { SignOutButton } from "@/components/sign-out-button";
import { DownloadButton } from "@/components/download-button";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [paid, config] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getPortalConfig(),
  ]);
  const license = paid ? await getActiveLicenseForUser(session.user.id).catch(() => null) : null;

  return (
    <main className="flex flex-1 flex-col px-4 py-10 sm:px-10">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-50">Horizon HFT Portal</h1>
          <p className="text-sm text-zinc-400">
            Welcome, {session.user.name ?? session.user.email ?? "trader"}
          </p>
        </div>
        <SignOutButton />
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
          <h2 className="text-sm font-medium text-cyan-400">Community</h2>
          <ul className="mt-3 space-y-2 text-sm text-zinc-300">
            <li>
              <a
                href={config.telegramChannelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-cyan-300 hover:underline"
              >
                @horizonhft channel
              </a>
            </li>
            <li>
              <a
                href={config.communityGroupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-cyan-300 hover:underline"
              >
                Free Users community group
              </a>
            </li>
            <li>
              <a
                href={config.testingGroupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-cyan-300 hover:underline"
              >
                Testing group
              </a>
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
          <h2 className="text-sm font-medium text-emerald-400">Pricing</h2>
          <p className="mt-3 text-sm text-zinc-300">{config.pricingDisplay}</p>
          <p className="mt-2 text-xs text-zinc-500">
            To upgrade, reach out on Telegram — our team issues licenses manually for now.
          </p>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 sm:col-span-2">
          <h2 className="text-sm font-medium text-blue-400">Educational content</h2>
          <ul className="mt-3 space-y-3">
            {config.educationPreview.map((doc) => (
              <li key={doc.title} className="text-sm">
                <p className="font-medium text-zinc-200">{doc.title}</p>
                <p className="text-zinc-400">{doc.summary}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 sm:col-span-2">
          <h2 className="text-sm font-medium text-zinc-400">Paid member area</h2>
          {paid ? (
            <div className="mt-3 space-y-4">
              <div>
                <p className="text-xs text-zinc-500">License key</p>
                <p className="mt-1 font-mono text-sm text-emerald-300">
                  {license?.licenseKey ?? "—"}
                </p>
                {license && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Expires {new Date(license.expiresAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              <DownloadButton />
            </div>
          ) : (
            <div className="mt-3">
              {/* Placeholder copy only — no real license/download data is fetched for unpaid sessions. */}
              <div aria-hidden className="pointer-events-none select-none blur-sm">
                <p className="text-sm text-zinc-300">
                  License key · Installer download · Full strategy docs
                </p>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black/40 px-4 py-3">
                <p className="text-sm text-zinc-300">Upgrade for full access</p>
                <a
                  href={config.telegramChannelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-cyan-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-cyan-400"
                >
                  Contact us
                </a>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
