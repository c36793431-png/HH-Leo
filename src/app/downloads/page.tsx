import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getActiveLicenseForUser } from "@/lib/licenses";
import { getInstallerInfo } from "@/lib/portal-config";
import { DownloadButton } from "@/components/download-button";
import { Logo } from "@/components/logo";

const PLACEHOLDER_VERSION = "1.0.0";
const PLACEHOLDER_CHANGELOG = "Release notes will appear here once the current build is published.";

export default async function DownloadsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const paid = await isPaidUser(session.user.id).catch(() => false);
  if (!paid) redirect("/dashboard");

  const [license, installer] = await Promise.all([
    getActiveLicenseForUser(session.user.id).catch(() => null),
    getInstallerInfo().catch(() => null),
  ]);

  const version = installer?.version ?? PLACEHOLDER_VERSION;
  const changelog = installer?.changelog ?? PLACEHOLDER_CHANGELOG;

  return (
    <main className="flex flex-1 flex-col px-4 py-10 sm:px-10">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <Logo size="nav" />
          <p className="mt-2 text-sm text-zinc-400">Downloads</p>
        </div>
        <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-cyan-300 hover:underline">
          Back to dashboard
        </Link>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
          <h2 className="text-sm font-medium text-cyan-400">Latest build</h2>
          <p className="mt-3 font-mono text-sm text-emerald-300">v{version}</p>
          {installer && (
            <p className="mt-1 text-xs text-zinc-500">
              Uploaded {new Date(installer.uploadedAt).toLocaleDateString()}
            </p>
          )}
          <div className="mt-4">
            {installer ? (
              <DownloadButton />
            ) : (
              <button
                type="button"
                disabled
                title="Build not yet published"
                className="cursor-not-allowed rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-500"
              >
                Download installer
              </button>
            )}
          </div>
          {!installer && (
            <p className="mt-2 text-xs text-zinc-500">No build published yet — check back soon.</p>
          )}
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
          <h2 className="text-sm font-medium text-blue-400">Changelog</h2>
          <p className="mt-3 whitespace-pre-line text-sm text-zinc-300">{changelog}</p>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 sm:col-span-2">
          <h2 className="text-sm font-medium text-zinc-400">Your license</h2>
          <p className="mt-1 text-xs text-zinc-500">License key</p>
          <p className="mt-1 font-mono text-sm text-emerald-300">{license?.licenseKey ?? "—"}</p>
          {license && (
            <p className="mt-1 text-xs text-zinc-500">
              Expires {new Date(license.expiresAt).toLocaleDateString()}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
