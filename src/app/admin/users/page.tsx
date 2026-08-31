import Link from "next/link";
import {
  listAllUsersWithLicenses,
  maskLicenseKey,
  FEED_TYPE_META,
  USERS_TIER_BUCKETS,
  type AdminUserRow,
  type HasLicenseFilter,
  type RoleFilter,
  type SignupSourceFilter,
  type UsersSortColumn,
  type UsersTierBucket,
} from "@/lib/licenses";
import { ALL_USER_ROLES, ROLE_LABELS, type UserRole } from "@/lib/admin-user-roles";
import { LICENSE_BADGE_STYLES as BADGE_STYLES, LICENSE_STATUS_BADGES as BADGES } from "@/lib/license-status-badge";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { DurationForm } from "@/components/admin/duration-form";
import { ActionButton } from "@/components/admin/action-button";
import { FeedSelectForm } from "@/components/admin/feed-select-form";
import { TierSelectForm } from "@/components/admin/tier-select-form";
import {
  expireNowAction,
  extendLicenseAction,
  revokeAction,
  issueNewLicenseAction,
  updateLicenseFeedsAction,
  setUserLicenseTierAction,
} from "./actions";

const PER_PAGE = 50;

const HAS_LICENSE_VALUES: HasLicenseFilter[] = ["active", "expiring", "expired", "revoked", "none"];
const SIGNUP_SOURCE_VALUES: SignupSourceFilter[] = ["telegram", "email-link", "both"];
const ROLE_VALUES: readonly RoleFilter[] = ALL_USER_ROLES;
const SORT_COLUMNS: { key: UsersSortColumn; label: string }[] = [
  { key: "joined_at", label: "Joined" },
  { key: "last_verified_at", label: "Last verified" },
  { key: "expires_at", label: "Expires" },
];

function getBadge(row: AdminUserRow): { label: string; color: keyof typeof BADGE_STYLES } {
  if (row.role === "admin") return { label: "ADMIN", color: "blue" };
  return BADGES[row.computedStatus];
}

/** Badge for one entry in a multi-license stack — activeLicenses is always
 * status='active' && expires_at > now(), so only "active"/"expiring" ever apply. */
function activeLicenseBadge(status: "active" | "expiring"): { label: string; color: keyof typeof BADGE_STYLES } {
  return BADGES[status];
}

function hasActiveLicense(row: AdminUserRow): boolean {
  return row.computedStatus === "active" || row.computedStatus === "expiring";
}

const TAB_LABELS: Record<UsersTierBucket, string> = {
  free: "Free",
  trial: "Trial",
  paid: "Paid",
  team: "Team",
  admin: "Admin",
  deal: "Deal",
};

interface RawSearchParams {
  q?: string;
  hasLicense?: string;
  signupSource?: string;
  role?: string;
  tab?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

function buildQuery(base: RawSearchParams, overrides: RawSearchParams): string {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  // Must be the bare path, not "" — <Link href=""> resolves to the CURRENT url, query
  // string included, so clicking "All" from /admin/users?tab=free navigated straight back
  // to ?tab=free and the filter appeared stuck. Only bit when no other param survived,
  // which is why the plain Free -> All click was the repro.
  return qs ? `?${qs}` : "/admin/users";
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const sort: UsersSortColumn = SORT_COLUMNS.some((c) => c.key === sp.sort)
    ? (sp.sort as UsersSortColumn)
    : "joined_at";
  const dir = sp.dir === "asc" ? "asc" : "desc";
  const hasLicense = HAS_LICENSE_VALUES.includes(sp.hasLicense as HasLicenseFilter)
    ? (sp.hasLicense as HasLicenseFilter)
    : undefined;
  const signupSource = SIGNUP_SOURCE_VALUES.includes(sp.signupSource as SignupSourceFilter)
    ? (sp.signupSource as SignupSourceFilter)
    : undefined;
  const role = ROLE_VALUES.includes(sp.role as RoleFilter) ? (sp.role as RoleFilter) : undefined;
  const tierBucket = USERS_TIER_BUCKETS.includes(sp.tab as UsersTierBucket)
    ? (sp.tab as UsersTierBucket)
    : undefined;
  const search = sp.q?.trim() || undefined;

  const { rows: users, total } = await listAllUsersWithLicenses({
    search,
    hasLicense,
    signupSource,
    role,
    tierBucket,
    sort,
    dir,
    page,
    perPage: PER_PAGE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Users
        </span>
        <p className="mt-2 text-sm text-zinc-400">All users, license state, per-row lifecycle actions</p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href={buildQuery(sp, { tab: undefined, page: undefined })}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            !tierBucket
              ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-300"
              : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          }`}
        >
          All
        </Link>
        {USERS_TIER_BUCKETS.map((tab) => (
          <Link
            key={tab}
            href={buildQuery(sp, { tab, page: undefined })}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              tierBucket === tab
                ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-300"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            {TAB_LABELS[tab]}
          </Link>
        ))}
      </div>

      <form className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-4">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-zinc-500">Search</label>
          <input
            name="q"
            type="text"
            defaultValue={sp.q ?? ""}
            placeholder="Email, name, or Telegram handle"
            className="mt-1 w-full rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">Has license</label>
          <select
            name="hasLicense"
            defaultValue={sp.hasLicense ?? ""}
            className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          >
            <option value="">Any</option>
            {HAS_LICENSE_VALUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-zinc-500">Signup source</label>
          <select
            name="signupSource"
            defaultValue={sp.signupSource ?? ""}
            className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          >
            <option value="">Any</option>
            {SIGNUP_SOURCE_VALUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-zinc-500">Role</label>
          <select
            name="role"
            defaultValue={sp.role ?? ""}
            className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          >
            <option value="">Any</option>
            {ROLE_VALUES.map((v) => (
              <option key={v} value={v}>
                {ROLE_LABELS[v]}
              </option>
            ))}
          </select>
        </div>
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
        {tierBucket && <input type="hidden" name="tab" value={tierBucket} />}
        <button
          type="submit"
          className="rounded-md bg-cyan-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-cyan-400"
        >
          Filter
        </button>
        {(search || hasLicense || signupSource || role) && (
          <Link href="/admin/users" className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline">
            Clear filters
          </Link>
        )}
      </form>

      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Role</th>
                <th className="pb-2 pr-4">Telegram</th>
                <th className="pb-2 pr-4">Source</th>
                <th className="pb-2 pr-4">
                  <Link
                    href={buildQuery(sp, {
                      sort: "joined_at",
                      dir: sort === "joined_at" && dir === "desc" ? "asc" : "desc",
                      page: undefined,
                    })}
                    className="hover:text-zinc-300 hover:underline"
                  >
                    Joined {sort === "joined_at" && (dir === "desc" ? "↓" : "↑")}
                  </Link>
                </th>
                <th className="pb-2 pr-4">License key</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">
                  <Link
                    href={buildQuery(sp, {
                      sort: "expires_at",
                      dir: sort === "expires_at" && dir === "asc" ? "desc" : "asc",
                      page: undefined,
                    })}
                    className="hover:text-zinc-300 hover:underline"
                  >
                    Expires {sort === "expires_at" && (dir === "desc" ? "↓" : "↑")}
                  </Link>
                </th>
                <th className="pb-2 pr-4">Tier</th>
                <th className="pb-2 pr-4">Feeds</th>
                <th className="pb-2 pr-4">HWID</th>
                <th className="pb-2 pr-4">
                  <Link
                    href={buildQuery(sp, {
                      sort: "last_verified_at",
                      dir: sort === "last_verified_at" && dir === "desc" ? "asc" : "desc",
                      page: undefined,
                    })}
                    className="hover:text-zinc-300 hover:underline"
                  >
                    Last verified {sort === "last_verified_at" && (dir === "desc" ? "↓" : "↑")}
                  </Link>
                </th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {users.map((u) => {
                const badge = getBadge(u);
                // Multiple active licenses (issueAdditionalLicense) means no single license
                // can stand in for "the" license — stack every active one instead of the
                // legacy single licenseId/... fields, which only ever tracked the newest.
                // See project_horizon_multi_license_visibility_2026-08-31 for the bug this
                // guards against: an older still-active license silently unreachable in
                // this list because a newer (possibly revoked/expired) one replaced it.
                const hasMultipleActive = u.role !== "admin" && u.activeLicenses.length > 1;
                return (
                  <tr key={u.userId} className="group">
                    <td className="py-2 pr-4 text-zinc-200">
                      <Link href={`/admin/users/${u.userId}`} className="hover:text-cyan-300 hover:underline">
                        {u.email ?? u.displayName ?? "—"}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-zinc-400">{ROLE_LABELS[u.role as UserRole] ?? u.role}</td>
                    <td className="py-2 pr-4 text-zinc-400">
                      {u.telegramUsername ? `@${u.telegramUsername}` : "—"}
                    </td>
                    <td className="py-2 pr-4 text-zinc-500 text-xs">{u.signupSource ?? "—"}</td>
                    <td className="py-2 pr-4 text-zinc-400">{formatRelative(u.joinedAt)}</td>
                    {hasMultipleActive ? (
                      <>
                        <td className="py-2 pr-4" colSpan={7}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {u.activeLicenses.map((lic) => {
                              const licBadge = activeLicenseBadge(lic.computedStatus);
                              return (
                                <span
                                  key={lic.licenseId}
                                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide ${BADGE_STYLES[licBadge.color]}`}
                                >
                                  HH{lic.licenseNumber} · {lic.tier}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/admin/users/${u.userId}`}
                              className="rounded border border-cyan-500/50 px-2 py-1 text-xs font-medium text-cyan-300 hover:border-cyan-400 hover:bg-cyan-500/10"
                            >
                              Manage ({u.activeLicenses.length})
                            </Link>
                            <DurationForm
                              action={issueNewLicenseAction}
                              hiddenFields={{ userId: u.userId }}
                              submitLabel="Issue"
                              successMessage="License issued"
                              compact
                              triggerLabel="Issue new license"
                            />
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2 pr-4 font-mono text-xs text-zinc-400">
                          {u.licenseKey ? (
                            <span className="flex items-center gap-1.5">
                              <span className="rounded-full border border-cyan-500/50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">
                                HH{u.licenseNumber}
                              </span>
                              {maskLicenseKey(u.licenseKey)}
                            </span>
                          ) : (
                            "—"
                          )}
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
                        <td className="py-2 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {u.feedTypes.length === 0 ? (
                              <span className="text-xs text-zinc-600">—</span>
                            ) : (
                              u.feedTypes.map((f) => (
                                <span
                                  key={f}
                                  className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-300"
                                >
                                  {FEED_TYPE_META[f].name}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs text-zinc-500">
                          {u.hardwareId ? `${u.hardwareId.slice(0, 4)}…` : "—"}
                        </td>
                        <td className="py-2 pr-4 text-zinc-400">
                          {u.lastVerifiedAt ? formatRelative(u.lastVerifiedAt) : "never"}
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-2">
                            {u.licenseId && (
                              <>
                                <ActionButton
                                  action={expireNowAction}
                                  hiddenFields={{ licenseId: u.licenseId }}
                                  label="Trigger expire now"
                                  successMessage="License expired"
                                />
                                <DurationForm
                                  action={extendLicenseAction}
                                  hiddenFields={{ licenseId: u.licenseId }}
                                  submitLabel="Apply"
                                  successMessage="License extended"
                                  compact
                                  triggerLabel="Extend"
                                  showExtendFrom
                                  defaultAmount={30}
                                  defaultUnit="days"
                                  triggerClassName="cursor-pointer select-none rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
                                />
                                {hasActiveLicense(u) && (
                                  <FeedSelectForm
                                    action={updateLicenseFeedsAction}
                                    hiddenFields={{ licenseId: u.licenseId }}
                                    currentFeedTypes={u.feedTypes}
                                    triggerClassName="cursor-pointer select-none rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300"
                                  />
                                )}
                                {/* Tier is a property of the licence row itself, not of its
                                    active/expired state, so this is gated on licenseId only —
                                    same as /admin/licenses, which lets an expired licence's tier
                                    be corrected. Rows with no licence render nothing here. */}
                                <TierSelectForm
                                  action={setUserLicenseTierAction}
                                  revokeAction={revokeAction}
                                  hiddenFields={{ licenseId: u.licenseId }}
                                  currentTier={u.tier ?? "paid"}
                                  confirmSubject={u.email ?? "this user"}
                                />
                                <ActionButton
                                  action={revokeAction}
                                  hiddenFields={{ licenseId: u.licenseId }}
                                  label="Revoke"
                                  successMessage="License revoked"
                                  className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                                />
                              </>
                            )}
                            <DurationForm
                              action={issueNewLicenseAction}
                              hiddenFields={{ userId: u.userId }}
                              submitLabel="Issue"
                              successMessage="License issued"
                              compact
                              triggerLabel="Issue new license"
                            />
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={13} className="py-4 text-center text-zinc-500">
                    {search || hasLicense || signupSource || role
                      ? "No users match these filters."
                      : "No users yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
            <span>
              Page {page} of {totalPages} ({total} total)
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={buildQuery(sp, { page: String(page - 1) })}
                  className="rounded border border-zinc-700 px-2 py-1 hover:border-zinc-500 hover:text-zinc-300"
                >
                  Previous
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={buildQuery(sp, { page: String(page + 1) })}
                  className="rounded border border-zinc-700 px-2 py-1 hover:border-zinc-500 hover:text-zinc-300"
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
