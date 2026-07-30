import Link from "next/link";
import {
  listAllUsersWithLicenses,
  maskLicenseKey,
  type AdminUserRow,
  type HasLicenseFilter,
  type SignupSourceFilter,
  type UsersSortColumn,
} from "@/lib/licenses";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { DurationForm } from "@/components/admin/duration-form";
import { ActionButton } from "@/components/admin/action-button";
import { expireNowAction, extendLicenseAction, revokeAction, issueNewLicenseAction } from "./actions";

const BADGE_STYLES = {
  green: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  amber: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  red: "border-red-500/40 bg-red-500/15 text-red-300",
  grey: "border-zinc-600/40 bg-zinc-600/15 text-zinc-400",
} as const;

const PER_PAGE = 50;

const HAS_LICENSE_VALUES: HasLicenseFilter[] = ["active", "expiring", "expired", "revoked", "none"];
const SIGNUP_SOURCE_VALUES: SignupSourceFilter[] = ["telegram", "email-link", "both"];
const SORT_COLUMNS: { key: UsersSortColumn; label: string }[] = [
  { key: "joined_at", label: "Joined" },
  { key: "last_verified_at", label: "Last verified" },
  { key: "expires_at", label: "Expires" },
];

const BADGES: Record<AdminUserRow["computedStatus"], { label: string; color: keyof typeof BADGE_STYLES }> = {
  none: { label: "NO LICENSE", color: "grey" },
  revoked: { label: "REVOKED", color: "red" },
  expired: { label: "EXPIRED", color: "red" },
  expiring: { label: "EXPIRING", color: "amber" },
  active: { label: "ACTIVE", color: "green" },
};

function getBadge(row: AdminUserRow): { label: string; color: keyof typeof BADGE_STYLES } {
  return BADGES[row.computedStatus];
}

interface RawSearchParams {
  q?: string;
  hasLicense?: string;
  signupSource?: string;
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
  return qs ? `?${qs}` : "";
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
  const search = sp.q?.trim() || undefined;

  const { rows: users, total } = await listAllUsersWithLicenses({
    search,
    hasLicense,
    signupSource,
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

      <form className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
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
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
        <button
          type="submit"
          className="rounded-md bg-cyan-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-cyan-400"
        >
          Filter
        </button>
        {(search || hasLicense || signupSource) && (
          <Link href="/admin/users" className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline">
            Clear filters
          </Link>
        )}
      </form>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Email</th>
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
                return (
                  <tr key={u.userId} className="group">
                    <td className="py-2 pr-4 text-zinc-200">
                      <Link href={`/admin/users/${u.userId}`} className="hover:text-cyan-300 hover:underline">
                        {u.email ?? u.displayName ?? "—"}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-zinc-400">
                      {u.telegramUsername ? `@${u.telegramUsername}` : "—"}
                    </td>
                    <td className="py-2 pr-4 text-zinc-500 text-xs">{u.signupSource ?? "—"}</td>
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
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-4 text-center text-zinc-500">
                    {search || hasLicense || signupSource
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
