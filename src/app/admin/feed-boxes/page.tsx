import { pool } from "@/lib/db";
import { listBoxRecords, listFeedBoxes, type RecordState } from "@/lib/feed-boxes";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { CreateBoxForm, IssueTokenButton } from "./box-forms";

/** Feed boxes (feed auto-provision, marcus m62546): each provider box, its tiers and token, and every allowlist
 * record on those tiers with what the box has done with it (Fable m62433 item 2: "pending bridge reload" is never
 * shown as active). Admin only, feed-ops surface. */
export const dynamic = "force-dynamic";

const STATE_CLASS: Record<RecordState["kind"], string> = {
  active: "text-emerald-400",
  pending: "text-amber-300",
  rejected: "text-red-400",
  ending: "text-zinc-400",
  removed: "text-zinc-500",
};

export default async function AdminFeedBoxesPage() {
  const boxes = await listFeedBoxes();
  const tiers = (await pool.query(`select id, tier_key, name from feed_tiers order by region_key, tier_key`)).rows.map(
    (t: { id: string; tier_key: string; name: string }) => ({ id: t.id, tierKey: t.tier_key, name: t.name })
  );
  const records = await Promise.all(boxes.map((b) => listBoxRecords(b.id)));

  return (
    <div className="flex flex-1 flex-col gap-8">
      <header>
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Feed boxes
        </span>
        <p className="mt-2 text-sm text-zinc-400">
          Provider boxes pull the allowlist for their tiers and report back what they applied. A record is active only
          once its box says so.
        </p>
      </header>

      {boxes.length === 0 && <p className="text-sm text-zinc-500">No boxes yet.</p>}

      {boxes.map((b, i) => (
        <section key={b.id} className="rounded-xl border border-cyan-400/35 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-sky-400">{b.name}</h2>
              <div className="mt-1 text-xs text-zinc-400">tiers: {b.tiers.map((t) => t.name).join(", ") || "none"}</div>
              <div className="text-xs text-zinc-500">
                last poll: {b.lastSeenAt ? `${formatAbsoluteUtc(b.lastSeenAt)} (${formatRelative(b.lastSeenAt)})` : "never"} · serial {b.serial} ·
                token: {b.hasToken ? `set${b.rotatedAt ? `, rotated ${formatAbsoluteUtc(b.rotatedAt)}` : ""}` : "none"}
              </div>
            </div>
            <IssueTokenButton boxId={b.id} hasToken={b.hasToken} />
          </div>
          <table className="mt-4 w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-medium">IP</th>
                <th className="py-1 pr-3 font-medium">Tier</th>
                <th className="py-1 pr-3 font-medium">Client server</th>
                <th className="py-1 pr-3 font-medium">Told</th>
                <th className="py-1 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {records[i].map((r) => (
                <tr key={r.recordId} className="border-t border-zinc-800">
                  <td className="py-1 pr-3 font-mono text-zinc-200">{r.ip}</td>
                  <td className="py-1 pr-3 text-zinc-400">{r.tierKey}</td>
                  <td className="py-1 pr-3 text-zinc-400">
                    {r.serverName ?? "—"}
                    {r.clientEmail ? <span className="text-zinc-500"> · {r.clientEmail}</span> : null}
                  </td>
                  <td className="py-1 pr-3 text-zinc-500">{formatAbsoluteUtc(r.toldAt)}</td>
                  <td className={`py-1 ${STATE_CLASS[r.state.kind]}`}>{r.state.label}</td>
                </tr>
              ))}
              {records[i].length === 0 && (
                <tr>
                  <td colSpan={5} className="py-2 text-zinc-500">
                    No allowlist records on these tiers.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ))}

      <section className="rounded-xl border border-zinc-800 p-5">
        <h2 className="mb-3 text-sm font-medium text-zinc-300">New box</h2>
        <CreateBoxForm tiers={tiers} />
      </section>
    </div>
  );
}
