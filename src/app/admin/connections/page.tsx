import Link from "next/link";
import { listConnectionOverview } from "@/lib/server-registration";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";

interface RawSearchParams {
  q?: string;
  flagged?: string;
}

export default async function AdminConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const search = sp.q?.trim().toLowerCase() || undefined;
  const flaggedOnly = sp.flagged === "1";

  const allRows = await listConnectionOverview();
  const rows = allRows.filter((r) => {
    if (flaggedOnly && !r.mismatch) return false;
    if (search) {
      const haystack = `${r.email ?? ""} ${r.serverName ?? ""} ${r.declaredIp ?? ""} ${r.latestIp ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Connections
        </span>
        <p className="mt-2 text-sm text-zinc-400">
          Declared server details vs actual captured IP/geoIP per license
        </p>
      </header>

      <form className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-4">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-zinc-500">Search</label>
          <input
            name="q"
            type="text"
            defaultValue={sp.q ?? ""}
            placeholder="Email, server name, or IP"
            className="mt-1 w-full rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input type="checkbox" name="flagged" value="1" defaultChecked={flaggedOnly} />
          Mismatches only
        </label>
        <button
          type="submit"
          className="rounded-md bg-cyan-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-cyan-400"
        >
          Filter
        </button>
        {(search || flaggedOnly) && (
          <Link href="/admin/connections" className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline">
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
                <th className="pb-2 pr-4">Server name</th>
                <th className="pb-2 pr-4">VPS provider</th>
                <th className="pb-2 pr-4">Declared IP</th>
                <th className="pb-2 pr-4">Latest actual IP</th>
                <th className="pb-2 pr-4">Declared location</th>
                <th className="pb-2 pr-4">GeoIP location</th>
                <th className="pb-2 pr-4">ISP</th>
                <th className="pb-2 pr-4">Last seen</th>
                <th className="pb-2">Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.map((r) => (
                <tr key={r.licenseId} className="group">
                  <td className="py-2 pr-4 text-zinc-200">
                    <Link
                      href={`/admin/connections/${r.licenseId}`}
                      className="hover:text-cyan-300 hover:underline"
                    >
                      {r.email ?? "—"}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{r.serverName ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-400">{r.vpsProvider ?? "—"}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-400">{r.declaredIp ?? "—"}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-400">{r.latestIp ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-400">{r.declaredLocation ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-400">
                    {[r.latestCity, r.latestCountry].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{r.latestIsp ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-400">
                    {r.latestCapturedAt ? formatRelative(r.latestCapturedAt) : "never"}
                  </td>
                  <td className="py-2">
                    {r.mismatch ? (
                      <span className="rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-300">
                        🚩 mismatch
                      </span>
                    ) : r.multipleIpsOk ? (
                      <span className="rounded-full border border-zinc-600/40 bg-zinc-600/15 px-2 py-0.5 text-xs text-zinc-400">
                        multi-IP OK
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-4 text-center text-zinc-500">
                    {search || flaggedOnly ? "No connections match these filters." : "No connections captured yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-zinc-600">
          Reference: {formatAbsoluteUtc(new Date())} — click a user to see their last 10 captured IPs.
        </p>
      </section>
    </div>
  );
}
