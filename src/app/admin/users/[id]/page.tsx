import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserDetail, maskLicenseKey, type UserTierLabel } from "@/lib/licenses";
import { listPaymentsForUser } from "@/lib/payments";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { DurationForm } from "@/components/admin/duration-form";
import { ActionButton } from "@/components/admin/action-button";
import { TierSelectForm } from "@/components/admin/tier-select-form";
import { CopyIdButton } from "@/components/admin/copy-id-button";
import { InlineEditField } from "@/components/admin/inline-edit-field";
import {
  expireNowAction,
  extendLicenseAction,
  revokeAction,
  issueNewLicenseAction,
  setUserLicenseTierAction,
  updateUserFieldAction,
} from "../actions";

const STATUS_STYLES = {
  active: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  expiring: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  expired: "border-red-500/40 bg-red-500/15 text-red-300",
  revoked: "border-red-500/40 bg-red-500/15 text-red-300",
} as const;

const TIER_BADGE_STYLES: Record<UserTierLabel, string> = {
  Paid: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  Trial: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  Team: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
  Deal: "border-purple-500/40 bg-purple-500/15 text-purple-300",
  "No Active License": "border-zinc-600/40 bg-zinc-600/15 text-zinc-400",
  Admin: "border-blue-500/40 bg-blue-500/15 text-blue-300",
};

const GROUP_STATUS_STYLES: Record<string, string> = {
  invited: "border-zinc-600/40 bg-zinc-600/15 text-zinc-400",
  joined: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  left: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  removed_on_lapse: "border-red-500/40 bg-red-500/15 text-red-300",
};

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [user, payments] = await Promise.all([getUserDetail(id), listPaymentsForUser(id)]);
  if (!user) notFound();

  const activeLicense = user.licenses.find(
    (l) => l.computedStatus === "active" || l.computedStatus === "expiring"
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/users" className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline">
            ← Back to Users
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-medium text-zinc-100">
              {user.email ?? user.displayName ?? "Unnamed user"}
            </h1>
            {user.displayName && user.email && (
              <span className="text-sm text-zinc-500">{user.displayName}</span>
            )}
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${TIER_BADGE_STYLES[user.tierLabel]}`}
            >
              {user.tierLabel.toUpperCase()}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Joined {formatAbsoluteUtc(user.joinedAt)} ({formatRelative(user.joinedAt)})
            {user.signins[0] && (
              <>
                {" "}· Last activity {formatRelative(user.signins[0].createdAt)}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeLicense && (
            <>
              <TierSelectForm
                action={setUserLicenseTierAction}
                hiddenFields={{ licenseId: activeLicense.id }}
                currentTier={activeLicense.tier}
              />
              <ActionButton
                action={revokeAction}
                hiddenFields={{ licenseId: activeLicense.id }}
                label="Revoke license"
                successMessage="License revoked"
                className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </>
          )}
          <CopyIdButton value={user.userId} label="Copy user ID" />
        </div>
      </header>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-cyan-400">Profile</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-zinc-500">Email</dt>
            <dd className="text-zinc-200">
              <InlineEditField
                action={updateUserFieldAction}
                hiddenFields={{ userId: user.userId }}
                field="email"
                type="email"
                value={user.email ?? ""}
                label="Email"
              />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Display name</dt>
            <dd className="text-zinc-200">
              <InlineEditField
                action={updateUserFieldAction}
                hiddenFields={{ userId: user.userId }}
                field="display_name"
                value={user.displayName ?? ""}
                label="Display name"
              />
            </dd>
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
            <dd className="text-zinc-200">
              <InlineEditField
                action={updateUserFieldAction}
                hiddenFields={{ userId: user.userId }}
                field="role"
                value={user.role}
                label="Role"
                options={["user", "admin"]}
              />
            </dd>
          </div>
        </dl>
        <div className="mt-4">
          <DurationForm
            action={issueNewLicenseAction}
            hiddenFields={{ userId: user.userId }}
            submitLabel="Issue"
            successMessage="License issued"
            compact
            triggerLabel="Issue new license"
            disabled={Boolean(activeLicense)}
            disabledReason={
              activeLicense
                ? `User has active license (expires ${formatAbsoluteUtc(activeLicense.expiresAt)}). Revoke it first to issue a new one.`
                : undefined
            }
          />
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-emerald-400">Licenses ({user.licenses.length})</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">License ID</th>
                <th className="pb-2 pr-4">Key</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Lifecycle</th>
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
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-600">{l.id.slice(0, 8)}…</td>
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-400">{maskLicenseKey(l.licenseKey)}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${STATUS_STYLES[l.computedStatus]}`}
                    >
                      {l.computedStatus.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-500 text-xs">{l.lifecycleState ?? "—"}</td>
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
                    {(l.computedStatus === "active" || l.computedStatus === "expiring") && (
                      <div className="flex flex-wrap gap-2">
                        <ActionButton
                          action={expireNowAction}
                          hiddenFields={{ licenseId: l.id }}
                          label="Trigger expire now"
                          successMessage="License expired"
                        />
                        <DurationForm
                          action={extendLicenseAction}
                          hiddenFields={{ licenseId: l.id }}
                          submitLabel="Apply"
                          successMessage="License extended"
                          compact
                          triggerLabel="Extend"
                          showExtendFrom
                          defaultAmount={30}
                          defaultUnit="days"
                          triggerClassName="cursor-pointer select-none rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
                        />
                        <ActionButton
                          action={revokeAction}
                          hiddenFields={{ licenseId: l.id }}
                          label="Revoke"
                          successMessage="License revoked"
                          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {user.licenses.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-4 text-center text-zinc-500">
                    No licenses yet — issue one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-sky-400">Telegram</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-zinc-500">Telegram user ID</dt>
            <dd className="text-zinc-200">{user.telegramUserId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Telegram username</dt>
            <dd className="text-zinc-200">{user.telegramUsername ? `@${user.telegramUsername}` : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Bot started</dt>
            <dd className="text-zinc-200">
              {user.telegramBotStartedAt ? (
                <>
                  {formatAbsoluteUtc(user.telegramBotStartedAt)}{" "}
                  <span className="text-zinc-600">({formatRelative(user.telegramBotStartedAt)})</span>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Chat</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Invited</th>
                <th className="pb-2">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {user.groupMemberships.map((g) => (
                <tr key={g.id}>
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-400">{g.chatId}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${GROUP_STATUS_STYLES[g.status] ?? GROUP_STATUS_STYLES.invited}`}
                    >
                      {g.status.replace(/_/g, " ").toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{formatRelative(g.invitedAt)}</td>
                  <td className="py-2 text-zinc-400">{g.joinedAt ? formatRelative(g.joinedAt) : "—"}</td>
                </tr>
              ))}
              {user.groupMemberships.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-zinc-500">
                    No group memberships recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-amber-400">Payments</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Amount</th>
                <th className="pb-2 pr-4">Direction</th>
                <th className="pb-2">Memo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(p.receivedAt)} <span className="text-zinc-600">({formatRelative(p.receivedAt)})</span>
                  </td>
                  <td className={`py-2 pr-4 ${p.direction === "in" ? "text-emerald-400" : "text-red-400"}`}>
                    {p.direction === "in" ? "+" : "−"}${p.amountUsd.toFixed(2)} {p.currency}
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{p.direction.toUpperCase()}</td>
                  <td className="py-2 text-zinc-300">{p.memo ?? "—"}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-zinc-500">
                    No payments logged.
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
    </div>
  );
}
