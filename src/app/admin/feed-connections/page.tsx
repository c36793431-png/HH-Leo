import { pool } from "@/lib/db";
import { listFeedTierConnections, symbolLinesText } from "@/lib/feed-connections";
import { formatAbsoluteUtc } from "@/lib/format-time";
import { ConnectionForm } from "./connection-forms";

/** Client connection details per feed tier (B3-2, marcus m64921 order; Fable m64916 N1/N4): one row per (tier,
 * connection type), what a client with live access needs to connect. Per-client usernames are set on
 * /admin/users/[id]. No password is kept or shown anywhere here. Admin only, feed-ops surface. Removing a row is not
 * offered yet (Fable N2, backlog). */
export const dynamic = "force-dynamic";

export default async function AdminFeedConnectionsPage() {
  const connections = await listFeedTierConnections();
  const tiers = (await pool.query(`select id, tier_key, name from feed_tiers order by region_key, tier_key`)).rows.map(
    (t: { id: string; tier_key: string; name: string }) => ({ id: t.id, tierKey: t.tier_key, name: t.name })
  );

  return (
    <div className="flex flex-1 flex-col gap-8">
      <header>
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Feed connections
        </span>
        <p className="mt-2 text-sm text-zinc-400">
          How a client with live access connects to each tier: host, port, data type, session hours and symbols, one row
          per connection type. Each client&apos;s username is set on their user page. No password is kept here: the FIX
          password is sent to the client separately.
        </p>
      </header>

      {connections.length === 0 && <p className="text-sm text-zinc-500">No connections set yet.</p>}

      {connections.map((c) => (
        <section key={`${c.feedTierId}:${c.connType}`} className="rounded-xl border border-cyan-400/35 p-5">
          <h2 className="text-sm font-medium text-sky-400">
            {c.tierName} <span className="text-zinc-500">({c.tierKey})</span> · {c.label}
          </h2>
          <div className="mt-1 text-xs text-zinc-400">
            <span className="font-mono text-zinc-200">{`${c.host}:${c.port}`}</span>
            {` · ${c.symbols.length} symbols`}
          </div>
          <div className="text-xs text-zinc-500">last saved {formatAbsoluteUtc(c.updatedAt)}</div>
          <div className="mt-4">
            <ConnectionForm
              row={{
                feedTierId: c.feedTierId,
                connType: c.connType,
                host: c.host,
                port: c.port,
                dataType: c.dataType,
                sessionHours: c.sessionHours,
                symbolsText: symbolLinesText(c.symbols),
              }}
            />
          </div>
        </section>
      ))}

      <section className="rounded-xl border border-zinc-800 p-5">
        <h2 className="mb-3 text-sm font-medium text-zinc-300">New connection</h2>
        <p className="mb-3 text-xs text-zinc-500">Saving a tier and type that already has a row replaces that row.</p>
        <ConnectionForm tiers={tiers} />
      </section>
    </div>
  );
}
