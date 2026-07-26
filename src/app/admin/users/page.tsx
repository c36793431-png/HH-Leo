import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listAllUsersWithLicenses, maskLicenseKey, type AdminUserRow } from "@/lib/licenses";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { ADMIN_USERS_PANEL_EMAIL } from "@/lib/admin-users-panel";
import { expireNowAction, extend30Action, revokeAction, issueNewLicenseAction } from "./actions";
import { Logo } from "@/components/logo";

const BADGE_STYLES = {
  green: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  amber: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  red: "border-red-500/40 bg-red-500/15 text-red-300",
  grey: "border-zinc-600/40 bg-zinc-600/15 text-zinc-400",
} as const;

const EXPIRING_SOON_MS = 24 * 60 * 60 * 1000;

function getBadge(row: AdminUserRow): { label: string; color: keyof typeof BADGE_STYLES } {
  if (!row.licenseId) return { label: "NO LICENSE", color: "grey" };
  if (row.status === "revoked") return { label: "REVOKED", color: "red" };
  const msUntilExpiry = row.expiresAt ? row.expiresAt.getTime() - Date.now() : 0;
  if (msUntilExpiry <= 0) return { label: "EXPIRED", color: "red" };
  if (msUntilExpiry < EXPIRING_SOON_MS) return { label: "EXPIRING", color: "amber" };
  return { label: "ACTIVE", color: "green" };
}

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.email !== ADMIN_USERS_PANEL_EMAIL) redirect("/dashboard");

  const users = await listAllUsersWithLicenses();

  return (
    <main className="flex flex-1 flex-col px-4 py-10 sm:px-10">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <Logo size="nav" />
          <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            Admin · Users
          </span>
        </div>
        <p className="mt-2 text-sm text-zinc-400">All users, license state, per-row lifecycle actions</p>
      </header>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Telegram</th>
                <th className="pb-2 pr-4">Joined</th>
                <th className="pb-2 pr-4">License key</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Expires</th>
                <th className="pb-2 pr-4">Tier</th>
                <th className="pb-2 pr-4">HWID</th>
                <th className="pb-2 pr-4">Last verified</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {users.map((u) => {
                const badge = getBadge(u);
                return (
                  <tr key={u.userId}>
                    <td className="py-2 pr-4 text-zinc-200">{u.email ?? "—"}</td>
                    <td className="py-2 pr-4 text-zinc-400">
                      {u.telegramUsername ? `@${u.telegramUsername}` : "—"}
                    </td>
                    <td className="py-2 pr-4 text-zinc-400">{formatRelative(u.joinedAt)}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-zinc-400">
                      {u.licenseKey ? maskLicenseKey(u.licenseKey) : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${BADGE_STYLES[badge.color]}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-zinc-400">
                      {u.expiresAt ? (
                        <>
                          {formatAbsoluteUtc(u.expiresAt)}{" "}
                          <span className="text-zinc-600">({formatRelative(u.expiresAt)})</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-4 text-zinc-400">{u.tier ?? "—"}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-zinc-400">
                      {u.hardwareId ? `${u.hardwareId.slice(0, 4)}…` : "—"}
                    </td>
                    <td className="py-2 pr-4 text-zinc-400">
                      {u.lastVerifiedAt ? formatRelative(u.lastVerifiedAt) : "never"}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        {u.licenseId && (
                          <>
                            <form action={expireNowAction}>
                              <input type="hidden" name="licenseId" value={u.licenseId} />
                              <button className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-amber-500 hover:text-amber-300">
                                Trigger expire now
                              </button>
                            </form>
                            <form action={extend30Action}>
                              <input type="hidden" name="licenseId" value={u.licenseId} />
                              <button className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300">
                                Extend 30d
                              </button>
                            </form>
                            <form action={revokeAction}>
                              <input type="hidden" name="licenseId" value={u.licenseId} />
                              <button className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300">
                                Revoke
                              </button>
                            </form>
                          </>
                        )}
                        <form action={issueNewLicenseAction}>
                          <input type="hidden" name="userId" value={u.userId} />
                          <button className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300">
                            Issue new license
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-4 text-center text-zinc-500">
                    No users yet.
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
