import Link from "next/link";
import {
  listAllLicenses,
  listDistinctTiers,
  maskLicenseKey,
  type LicenseStatusFilter,
  type ExpiresWithinFilter,
} from "@/lib/licenses";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { DurationForm } from "@/components/admin/duration-form";
import { extendLicenseFromListAction, revokeLicenseFromListAction } from "./actions";

const STATUS_STYLES = {
  active: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  expiring: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  expired: "border-red-500/40 bg-red-500/15 text-red-300",
  revoked: "border-red-500/40 bg-red-500/15 text-red-300",
} as const;

const PER_PAGE = 50;
const STATUS_VALUES: LicenseStatusFilter[] = ["active", "expiring", "expired", "revoked"];
const EXPIRES_WITHIN_VALUES: ExpiresWithinFilter[] = ["24h", "7d", "30d"];

interface RawSearchParams {
  status?: string;
  tier?: string;
  expiresWithin?: string;
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

export default async function AdminLicensesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = STATUS_VALUES.includes(sp.status as LicenseStatusFilter)
    ? (sp.status as LicenseStatusFilter)
    : undefined;
  const expiresWithin = EXPIRES_WITHIN_VALUES.includes(sp.expiresWithin as ExpiresWithinFilter)
    ? (sp.expiresWithin as ExpiresWithinFilter)
    : undefined;
  const tier = sp.tier?.trim() || undefined;

  const [{ rows: licenses, total }, tiers] = await Promise.all([
    listAllLicenses({ status, tier, expiresWithin, page, perPage: PER_PAGE }),
    listDistinctTiers(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Licenses
        </span>
        <p className="mt-2 text-sm text-zinc-400">
          Every license (past + present), license-first — no need to look up the owning user.
        </p>
      </header>

      <form className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div>
          <label className="block text-xs text-zinc-500">Status</label>
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          >
            <option value="">Any</option>
            {STATUS_VALUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-zinc-500">Tier</label>
          <select
            name="tier"
            defaultValue={sp.tier ?? ""}
            className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          >
            <option value="">Any</option>
            {tiers.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-zinc-500">Expires within</label>
          <select
            name="expiresWithin"
            defaultValue={sp.expiresWithin ?? ""}
            className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          >
            <option value="">Any</option>
            {EXPIRES_WITHIN_VALUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-cyan-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-cyan-400"
        >
          Filter
        </button>
        {(status || tier || expiresWithin) && (
          <Link href="/admin/licenses" className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline">
            Clear filters
          </Link>
        )}
      </form>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Key</th>
                <th className="pb-2 pr-4">User</th>
                <th className="pb-2 pr-4">Tier</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Issued</th>
                <th className="pb-2 pr-4">Expires ↑</th>
                <th className="pb-2 pr-4">HWID</th>
                <th className="pb-2 pr-4">Last verified</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {licenses.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-400">{maskLicenseKey(l.licenseKey)}</td>
                  <td className="py-2 pr-4 text-zinc-200">
                    {l.userId ? (
                      <Link href={`/admin/users/${l.userId}`} className="hover:text-cyan-300 hover:underline">
                        {l.email ?? "—"}
                      </Link>
                    ) : l.claimEmail ? (
                      <span className="text-zinc-500">{l.claimEmail} (pending claim)</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{l.tier}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${STATUS_STYLES[l.computedStatus]}`}
                    >
                      {l.computedStatus.toUpperCase()}
                    </span>
                  </td>
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
                    <div className="flex flex-wrap gap-2">
                      {(l.computedStatus === "active" || l.computedStatus === "expiring") && (
                        <>
                          <DurationForm
                            action={extendLicenseFromListAction}
                            hiddenFields={{ licenseId: l.id }}
                            submitLabel="Apply"
                            compact
                            triggerLabel="Extend"
                            showExtendFrom
                            defaultAmount={30}
                            defaultUnit="days"
                            triggerClassName="cursor-pointer select-none rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
                          />
                          <form action={revokeLicenseFromListAction}>
                            <input type="hidden" name="licenseId" value={l.id} />
                            <button className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300">
                              Revoke
                            </button>
                          </form>
                        </>
                      )}
                      {l.userId && (
                        <Link
                          href={`/admin/users/${l.userId}`}
                          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300"
                        >
                          View user
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {licenses.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-zinc-500">
                    {status || tier || expiresWithin
                      ? "No licenses match these filters."
                      : "No licenses yet — issue one from the Users tab."}
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
