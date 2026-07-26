import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserDetail, maskLicenseKey } from "@/lib/licenses";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { expireNowAction, extend30Action, revokeAction, issueNewLicenseAction } from "../actions";

const STATUS_STYLES = {
  active: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  expired: "border-red-500/40 bg-red-500/15 text-red-300",
  revoked: "border-red-500/40 bg-red-500/15 text-red-300",
} as const;

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getUserDetail(id);
  if (!user) notFound();

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-10 sm:px-10">
      <header>
        <Link href="/admin/users" className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline">
          ← Back to Users
        </Link>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">
          {user.email ?? user.displayName ?? "Unnamed user"}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Joined {formatAbsoluteUtc(user.joinedAt)} ({formatRelative(user.joinedAt)})
        </p>
      </header>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-cyan-400">Profile</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-zinc-500">Email</dt>
            <dd className="text-zinc-200">{user.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Display name</dt>
            <dd className="text-zinc-200">{user.displayName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Telegram</dt>
            <dd className="text-zinc-200">
              {user.telegramUsername ? `@${user.telegramUsername}` : "—"}{" "}
              {user.telegramUserId && <span className="text-zinc-600">({user.telegramUserId})</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Role</dt>
            <dd className="text-zinc-200">{user.role}</dd>
          </div>
        </dl>
        <div className="mt-4">
          <form action={issueNewLicenseAction}>
            <input type="hidden" name="userId" value={user.userId} />
            <button className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300">
              Issue new license
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-emerald-400">Licenses ({user.licenses.length})</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Key</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Tier</th>
                <th className="pb-2 pr-4">Issued</th>
                <th className="pb-2 pr-4">Expires</th>
                <th className="pb-2 pr-4">HWID</th>
                <th className="pb-2 pr-4">Last verified</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {user.licenses.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-400">{maskLicenseKey(l.licenseKey)}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${STATUS_STYLES[l.computedStatus]}`}
                    >
                      {l.computedStatus.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{l.tier}</td>
                  <td className="py-2 pr-4 text-zinc-400">{formatRelative(l.issuedAt)}</td>
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(l.expiresAt)}{" "}
                    <span className="text-zinc-600">({formatRelative(l.expiresAt)})</span>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-400">
                    {l.hardwareId ? `${l.hardwareId.slice(0, 4)}…` : "—"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">
                    {l.lastVerifiedAt ? formatRelative(l.lastVerifiedAt) : "never"}
                  </td>
                  <td className="py-2">
                    {l.computedStatus === "active" && (
                      <div className="flex flex-wrap gap-2">
                        <form action={expireNowAction}>
                          <input type="hidden" name="licenseId" value={l.id} />
                          <button className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-amber-500 hover:text-amber-300">
                            Trigger expire now
                          </button>
                        </form>
                        <form action={extend30Action}>
                          <input type="hidden" name="licenseId" value={l.id} />
                          <button className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300">
                            Extend 30d
                          </button>
                        </form>
                        <form action={revokeAction}>
                          <input type="hidden" name="licenseId" value={l.id} />
                          <button className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300">
                            Revoke
                          </button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {user.licenses.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-zinc-500">
                    No licenses yet — issue one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-blue-400">Signin history (last 20)</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">When</th>
                <th className="pb-2">Provider</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {user.signins.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(s.createdAt)} <span className="text-zinc-600">({formatRelative(s.createdAt)})</span>
                  </td>
                  <td className="py-2 text-zinc-300">{s.provider}</td>
                </tr>
              ))}
              {user.signins.length === 0 && (
                <tr>
                  <td colSpan={2} className="py-4 text-center text-zinc-500">
                    No signins recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-zinc-400">Admin actions taken against this user</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">When</th>
                <th className="pb-2 pr-4">Action</th>
                <th className="pb-2">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {user.adminActions.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-4 text-zinc-400">{formatRelative(a.createdAt)}</td>
                  <td className="py-2 pr-4 text-zinc-300">{a.action}</td>
                  <td className="py-2 text-zinc-400">{a.actorEmail ?? "—"}</td>
                </tr>
              ))}
              {user.adminActions.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-zinc-500">
                    No admin actions taken yet.
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
