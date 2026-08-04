import Link from "next/link";
import {
  listAllConfigSummaries,
  type ConfigSummaryTierFilter,
  type ConfigSummaryUpdatedWithinFilter,
} from "@/lib/config-summary";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";

const TIER_FILTERS: ConfigSummaryTierFilter[] = ["free", "trial", "paid", "team", "deal"];
const UPDATED_WITHIN_FILTERS: ConfigSummaryUpdatedWithinFilter[] = ["24h", "7d", "30d"];

interface RawSearchParams {
  tier?: string;
  source?: string;
  symbol?: string;
  updatedWithin?: string;
}

export default async function AdminSetupsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const tier = TIER_FILTERS.includes(sp.tier as ConfigSummaryTierFilter)
    ? (sp.tier as ConfigSummaryTierFilter)
    : undefined;
  const source = sp.source === "self_reported" || sp.source === "admin_verified" ? sp.source : undefined;
  const symbolContains = sp.symbol?.trim() || undefined;
  const updatedWithin = UPDATED_WITHIN_FILTERS.includes(sp.updatedWithin as ConfigSummaryUpdatedWithinFilter)
    ? (sp.updatedWithin as ConfigSummaryUpdatedWithinFilter)
    : undefined;

  const rows = await listAllConfigSummaries({ tier, source, symbolContains, updatedWithin });

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Setups
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">User setups</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Fleet-wide view of every reported Horizon config — what brokers, symbols, and strategies the team is running.
        </p>
      </header>

      <form className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-4">
        <div>
          <label className="block text-xs text-zinc-500">Tier</label>
          <select
            name="tier"
            defaultValue={sp.tier ?? ""}
            className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          >
            <option value="">All</option>
            {TIER_FILTERS.map((t) => (
              <option key={t} value={t}>
                {t.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-zinc-500">Source</label>
          <select
            name="source"
            defaultValue={sp.source ?? ""}
            className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          >
            <option value="">All</option>
            <option value="self_reported">Self</option>
            <option value="admin_verified">Admin</option>
          </select>
        </div>
        <div className="min-w-[160px]">
          <label className="block text-xs text-zinc-500">Symbol contains</label>
          <input
            name="symbol"
            type="text"
            defaultValue={sp.symbol ?? ""}
            placeholder="e.g. NQ"
            className="mt-1 w-full rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">Updated within</label>
          <select
            name="updatedWithin"
            defaultValue={sp.updatedWithin ?? ""}
            className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          >
            <option value="">All</option>
            {UPDATED_WITHIN_FILTERS.map((v) => (
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
        {(tier || source || symbolContains || updatedWithin) && (
          <Link href="/admin/setups" className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline">
            Clear filters
          </Link>
        )}
      </form>

      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">User</th>
                <th className="pb-2 pr-4">Tier</th>
                <th className="pb-2 pr-4">Broker</th>
                <th className="pb-2 pr-4">Account type</th>
                <th className="pb-2 pr-4">Symbols</th>
                <th className="pb-2 pr-4">Strategy</th>
                <th className="pb-2 pr-4">Updated</th>
                <th className="pb-2 pr-4">Source</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td className="py-2 pr-4 text-zinc-200">{r.email ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-400">{r.tier ? r.tier.toUpperCase() : "FREE"}</td>
                  <td className="py-2 pr-4 text-zinc-300">{r.broker ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-300">{r.accountType ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {r.symbols.length === 0 ? (
                        <span className="text-xs text-zinc-600">—</span>
                      ) : (
                        r.symbols.map((s) => (
                          <span
                            key={s}
                            className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-300"
                          >
                            {s}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-4 text-zinc-300">{r.strategy ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(r.updatedAt)} <span className="text-zinc-600">({formatRelative(r.updatedAt)})</span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">
                    {r.source === "admin_verified" ? "Admin" : "Self"}
                  </td>
                  <td className="py-2">
                    <Link
                      href={`/admin/users/${r.userId}#config-summary`}
                      className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-zinc-500">
                    No setups reported yet.
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
