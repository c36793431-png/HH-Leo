import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getActiveLicenseForUser, getLicenseForUser } from "@/lib/licenses";
import { getPortalConfig } from "@/lib/portal-config";
import { pool } from "@/lib/db";
import { getBotUsername } from "@/lib/telegram-bot";
import { SignOutButton } from "@/components/sign-out-button";
import Link from "next/link";
import { DownloadButton } from "@/components/download-button";
import { LinkTelegramButton } from "@/components/link-telegram-button";
import { Logo } from "@/components/logo";
import { UserAvatar } from "@/components/user-avatar";
import { LicenseStatusCard } from "@/components/license-status-card";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";

const RENEWAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function getRenewalState(paid: boolean, license: { expiresAt: Date } | null) {
  if (!paid || !license) return { renewsSoon: false, daysToExpiry: 0 };
  const msRemaining = license.expiresAt.getTime() - Date.now();
  return {
    renewsSoon: msRemaining < RENEWAL_WINDOW_MS,
    daysToExpiry: Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000))),
  };
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [paid, config, telegramLinked, botUsername] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getPortalConfig(),
    pool
      .query<{ telegram_user_id: string | null }>(
        "select telegram_user_id from users where id = $1",
        [session.user.id]
      )
      .then((r) => r.rows[0]?.telegram_user_id !== null && r.rows[0]?.telegram_user_id !== undefined)
      .catch(() => false),
    getBotUsername(),
  ]);
  const license = paid ? await getActiveLicenseForUser(session.user.id).catch(() => null) : null;
  const licenseDetail = await getLicenseForUser(session.user.id).catch(() => null);
  const isAdmin = isAdminUsersPanelEmail(session.user.email);
  const { renewsSoon, daysToExpiry } = getRenewalState(paid, license);

  return (
    <main className="flex flex-1 flex-col px-4 py-10 sm:px-10">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <Logo size="nav" />
          <div className="mt-2 flex items-center gap-2">
            <UserAvatar
              name={session.user.name ?? session.user.email ?? "trader"}
              imageUrl={session.user.image}
            />
            <p className="text-sm text-zinc-400">
              Welcome, {session.user.name ?? session.user.email ?? "trader"}
            </p>
          </div>
        </div>
        <SignOutButton />
      </header>

      {!paid && (
        <section className="mb-6 rounded-xl border border-cyan-500/60 bg-gradient-to-br from-cyan-500/10 via-teal-500/5 to-transparent p-6 shadow-[0_0_20px_-6px_rgba(34,211,238,0.5)]">
          <h2 className="text-lg font-semibold text-cyan-300">Upgrade to Paid</h2>
          <p className="mt-2 text-sm text-zinc-300">{config.pricingDisplay}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={config.telegramChannelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-cyan-500/90 px-4 py-2 text-sm font-medium text-black hover:bg-cyan-400"
            >
              Upgrade to Paid
            </a>
            <a
              href={config.telegramChannelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:border-cyan-500/60 hover:text-cyan-300"
            >
              See what&apos;s included
            </a>
          </div>
        </section>
      )}

      {paid && renewsSoon && (
        <section className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-sm text-amber-300">
            Your license renews in {daysToExpiry} day{daysToExpiry === 1 ? "" : "s"}.{" "}
            <a
              href={config.telegramChannelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline hover:text-amber-200"
            >
              Renew now →
            </a>
          </p>
        </section>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <LicenseStatusCard
          license={licenseDetail}
          telegramChannelUrl={config.telegramChannelUrl}
        />

        <section className="rounded-xl border border-cyan-500/60 bg-zinc-950/60 p-6 shadow-[0_0_20px_-6px_rgba(34,211,238,0.5)]">
          <h2 className="text-sm font-medium text-cyan-400">Downloads</h2>
          {paid ? (
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-xs text-zinc-500">Latest build</p>
                <p className="mt-1 font-mono text-sm text-emerald-300">
                  {license?.licenseKey ? "Installer ready" : "—"}
                </p>
              </div>
              <DownloadButton />
              <p className="text-sm">
                <Link href="/downloads" className="text-cyan-400 hover:text-cyan-300 hover:underline">
                  View downloads &amp; changelog
                </Link>
              </p>
            </div>
          ) : (
            <div className="relative mt-3">
              <div aria-hidden className="pointer-events-none select-none space-y-2 opacity-50 blur-[2px]">
                <p className="text-sm text-zinc-300">horizon-installer-win-x64.exe · v4.2.1</p>
                <p className="text-sm text-zinc-300">horizon-installer-macos.pkg · v4.2.1</p>
                <p className="text-sm text-zinc-300">Changelog · download history</p>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-black/40 px-4 py-3">
                <p className="text-sm text-zinc-300">🔒 Installers &amp; downloads are Paid-only</p>
                <a
                  href={config.telegramChannelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-amber-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-amber-400"
                >
                  Upgrade to unlock →
                </a>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-cyan-500/60 bg-zinc-950/60 p-6 shadow-[0_0_20px_-6px_rgba(34,211,238,0.5)] sm:col-span-2">
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
            <li className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-3">
              {paid ? (
                telegramLinked ? (
                  <span className="text-emerald-300">Paid Users Group · invite sent via Telegram</span>
                ) : (
                  <div className="flex w-full flex-wrap items-center justify-between gap-3">
                    <span className="text-zinc-300">Paid Users Group — link Telegram to get your invite</span>
                    {botUsername ? (
                      <LinkTelegramButton botUsername={botUsername} />
                    ) : (
                      <span className="text-xs text-zinc-500">Telegram linking unavailable — bot not configured.</span>
                    )}
                  </div>
                )
              ) : (
                <>
                  <span className="text-zinc-500">🔒 Paid Users Group</span>
                  <a
                    href={config.telegramChannelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md bg-amber-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-amber-400"
                  >
                    Upgrade to join →
                  </a>
                </>
              )}
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-cyan-500/60 bg-zinc-950/60 p-6 shadow-[0_0_20px_-6px_rgba(34,211,238,0.5)] sm:col-span-2">
          <h2 className="text-sm font-medium text-blue-400">Educational content</h2>
          <ul className="mt-3 space-y-3">
            {config.educationPreview.map((doc, i) => (
              <li key={doc.title} className="text-sm">
                <p className="font-medium text-zinc-200">
                  {doc.title}{" "}
                  {i === 0 && (
                    <span className="ml-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                      Free intro
                    </span>
                  )}
                </p>
                <p className="text-zinc-400">{doc.summary}</p>
              </li>
            ))}
          </ul>
          {!paid && (
            <div className="mt-4 relative">
              <div aria-hidden className="pointer-events-none select-none space-y-2 opacity-50 blur-[2px]">
                <p className="text-sm text-zinc-300">Advanced execution tuning</p>
                <p className="text-sm text-zinc-300">Masterclass: multi-venue arbitrage</p>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-black/40 px-4 py-3">
                <p className="text-sm text-zinc-300">🔒 2 advanced courses locked</p>
                <a
                  href={config.telegramChannelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-amber-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-amber-400"
                >
                  Upgrade to unlock →
                </a>
              </div>
            </div>
          )}
        </section>

        {isAdmin && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 sm:col-span-2">
            <h2 className="text-sm font-medium text-zinc-400">Admin quick access</h2>
            <p className="mt-1 text-xs text-zinc-500">Admin access is license-independent.</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href="/admin/users" className="text-zinc-300 hover:text-cyan-300 hover:underline">
                  Users →
                </Link>
              </li>
              <li>
                <Link href="/admin/licenses" className="text-zinc-300 hover:text-cyan-300 hover:underline">
                  Licenses →
                </Link>
              </li>
              <li>
                <Link href="/admin/history" className="text-zinc-300 hover:text-cyan-300 hover:underline">
                  History →
                </Link>
              </li>
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
