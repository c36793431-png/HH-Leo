import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listClients } from "@/lib/licenses";
import { getInstallerInfo } from "@/lib/portal-config";
import {
  issueLicenseAction,
  extendLicenseAction,
  revokeLicenseAction,
  resendWelcomeAction,
  uploadInstallerAction,
} from "./actions";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  const [clients, installer] = await Promise.all([listClients(), getInstallerInfo()]);

  return (
    <main className="flex flex-1 flex-col px-4 py-10 sm:px-10">
      <header className="mb-8">
        <h1 className="text-lg font-semibold text-zinc-50">Admin — Horizon HFT Portal</h1>
        <p className="text-sm text-zinc-400">Client management, licensing, downloads</p>
      </header>

      <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-cyan-400">Pre-provision a license</h2>
        <p className="mt-1 text-xs text-zinc-500">
          For clients who paid before signing up on the portal — bind by email or Telegram user ID;
          they claim it automatically on first login.
        </p>
        <form action={issueLicenseAction} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-zinc-500">Email</label>
            <input
              name="email"
              type="email"
              className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500">Telegram user ID</label>
            <input
              name="telegramUserId"
              type="number"
              className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-cyan-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-cyan-400"
          >
            Pre-provision
          </button>
        </form>
      </section>

      <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-emerald-400">Downloads</h2>
        {installer ? (
          <p className="mt-2 text-sm text-zinc-300">
            Current: v{installer.version} — {installer.filename} (uploaded{" "}
            {new Date(installer.uploadedAt).toLocaleString()})
          </p>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">No installer uploaded yet.</p>
        )}
        <form action={uploadInstallerAction} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-zinc-500">Version</label>
            <input
              name="version"
              type="text"
              placeholder="1.2.0"
              required
              className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500">Installer file</label>
            <input name="file" type="file" required className="mt-1 text-sm text-zinc-300" />
          </div>
          <button
            type="submit"
            className="rounded-md bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-emerald-400"
          >
            Upload build
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-blue-400">Clients</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Email / Telegram</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Expires</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {clients.map((c) => (
                <tr key={c.userId}>
                  <td className="py-2 pr-4 text-zinc-200">
                    {c.email ?? "—"}
                    {c.telegramUsername ? ` · @${c.telegramUsername}` : ""}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={c.paid ? "text-emerald-400" : "text-zinc-500"}>
                      {c.paid ? "Paid" : c.status === "revoked" ? "Revoked" : "Free"}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">
                    {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      <form action={issueLicenseAction}>
                        <input type="hidden" name="userId" value={c.userId} />
                        <button className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300">
                          Issue license
                        </button>
                      </form>
                      {c.licenseId && (
                        <>
                          <form action={extendLicenseAction}>
                            <input type="hidden" name="licenseId" value={c.licenseId} />
                            <input type="hidden" name="days" value="30" />
                            <button className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300">
                              Extend 30d
                            </button>
                          </form>
                          <form action={revokeLicenseAction}>
                            <input type="hidden" name="licenseId" value={c.licenseId} />
                            <button className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300">
                              Revoke
                            </button>
                          </form>
                        </>
                      )}
                      <form action={resendWelcomeAction}>
                        <input type="hidden" name="userId" value={c.userId} />
                        <button className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-blue-500 hover:text-blue-300">
                          Resend welcome
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-zinc-500">
                    No signups yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
