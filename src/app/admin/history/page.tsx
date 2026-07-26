import Link from "next/link";
import { listAdminActions, listAdminActionActors, listAdminActionTypes } from "@/lib/admin";
import { maskLicenseKey } from "@/lib/licenses";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";

const PER_PAGE = 50;

interface RawSearchParams {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
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

export default async function AdminHistoryPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const from = sp.from ? new Date(sp.from) : undefined;
  const to = sp.to ? new Date(`${sp.to}T23:59:59.999Z`) : undefined;

  const [{ rows: actions, total }, actors, actionTypes] = await Promise.all([
    listAdminActions({
      actorUserId: sp.actor || undefined,
      action: sp.action || undefined,
      from: from && !Number.isNaN(from.getTime()) ? from : undefined,
      to: to && !Number.isNaN(to.getTime()) ? to : undefined,
      page,
      perPage: PER_PAGE,
    }),
    listAdminActionActors(),
    listAdminActionTypes(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · History
        </span>
        <p className="mt-2 text-sm text-zinc-400">
          Every admin action, chronological, newest first. Read-only.
        </p>
      </header>

      <form className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div>
          <label className="block text-xs text-zinc-500">Actor</label>
          <select
            name="actor"
            defaultValue={sp.actor ?? ""}
            className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          >
            <option value="">Any</option>
            {actors.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.email ?? a.userId}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-zinc-500">Action type</label>
          <select
            name="action"
            defaultValue={sp.action ?? ""}
            className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          >
            <option value="">Any</option>
            {actionTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-zinc-500">From</label>
          <input
            type="date"
            name="from"
            defaultValue={sp.from ?? ""}
            className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">To</label>
          <input
            type="date"
            name="to"
            defaultValue={sp.to ?? ""}
            className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-cyan-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-cyan-400"
        >
          Filter
        </button>
        {(sp.actor || sp.action || sp.from || sp.to) && (
          <Link href="/admin/history" className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline">
            Clear filters
          </Link>
        )}
      </form>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">When</th>
                <th className="pb-2 pr-4">Action</th>
                <th className="pb-2 pr-4">Actor</th>
                <th className="pb-2 pr-4">Target user</th>
                <th className="pb-2">Target license</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {actions.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(a.createdAt)}{" "}
                    <span className="text-zinc-600">({formatRelative(a.createdAt)})</span>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-300">{a.action}</td>
                  <td className="py-2 pr-4 text-zinc-400">{a.actorEmail ?? "—"}</td>
                  <td className="py-2 pr-4">
                    {a.targetUserId ? (
                      <Link href={`/admin/users/${a.targetUserId}`} className="text-cyan-400 hover:text-cyan-300 hover:underline">
                        {a.targetUserEmail ?? a.targetUserId}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2">
                    {a.targetLicenseId && a.targetLicenseKey ? (
                      <span className="font-mono text-xs text-zinc-400">{maskLicenseKey(a.targetLicenseKey)}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {actions.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-zinc-500">
                    No admin actions recorded yet.
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
