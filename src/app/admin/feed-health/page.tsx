import { listAllowlistBoxPolls, listFeedStatus, type EffectiveKind, type StatusRowView } from "@/lib/feed-status";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";

/** Feed health (plan m64510-2; v1 = /admin only, marcus m64531). What each measuring box last reported, per feed and
 * symbol, with staleness computed from the portal's receive clock (feed-status.ts). The worst symbol sets the feed's
 * badge (marcus m64552). Allowlist boxes appear only as "Box reporting · last poll": a poll proves the box is polling,
 * not that ticks flow. Uptime and latency stay unmeasured: the portal keeps no history (Q3). Admin only. */
export const dynamic = "force-dynamic";

const PILL: Record<EffectiveKind | "no_rows", string> = {
  up: "border-emerald-500/50 text-emerald-300",
  stale: "border-amber-500/50 text-amber-300",
  down: "border-red-500/60 text-red-300",
  no_report: "border-red-500/60 text-red-300",
  closed: "border-zinc-600 text-zinc-400",
  not_measured: "border-zinc-600 text-zinc-400",
  collector_stopped: "border-zinc-600 text-zinc-400",
  unknown: "border-zinc-600 text-zinc-400",
  not_in_last_report: "border-zinc-600 text-zinc-400",
  no_rows: "border-zinc-700 text-zinc-500",
};

function Pill({ kind, label }: { kind: EffectiveKind | "no_rows"; label: string }) {
  return <span className={`rounded border px-1.5 py-0.5 text-[11px] ${PILL[kind]}`}>{label}</span>;
}

const num = (v: number | null, unit = "") => (v === null ? "—" : `${v.toLocaleString("en-US")}${unit}`);

function metrics(r: StatusRowView) {
  return `${num(r.ticksPerMin)} ticks/min · gap p50 ${num(r.gapP50Ms, " ms")} / p99 ${num(r.gapP99Ms, " ms")}`;
}

export default async function AdminFeedHealthPage() {
  const now = new Date();
  const [boxes, polls] = await Promise.all([listFeedStatus(now), listAllowlistBoxPolls()]);

  return (
    <div className="flex flex-1 flex-col gap-8">
      <header>
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Feed health
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Feed health</h1>
        <p className="mt-1 text-sm text-zinc-400">
          What each measuring box last reported. A report older than 2 minutes reads Unknown; older than 10 minutes, No
          report. Gaps are the box&apos;s last 5 minutes. Uptime and latency are not measured: no history is kept.
        </p>
      </header>

      {boxes.length === 0 && <p className="text-sm text-zinc-500">No box reports feed status yet. Set a box&apos;s status tiers on Feed boxes.</p>}

      {boxes.map((b) => (
        <section key={b.id} data-box={b.name} className="rounded-xl border border-cyan-400/35 p-5">
          <h2 className="text-sm font-medium text-sky-400">{b.name}</h2>
          <div className="mt-1 text-xs text-zinc-500">
            {`last report: ${b.statusReportedAt ? `${formatAbsoluteUtc(b.statusReportedAt)} (${formatRelative(b.statusReportedAt)})` : "never"}`}
            {b.collectorVersion ? ` · collector ${b.collectorVersion}` : ""}
            {b.measuring === false ? " · FeedCompare not running" : ""}
          </div>
          {b.ignored.length > 0 && (
            <div className="mt-1 text-xs text-amber-300">
              {`box reported ${b.ignored.length} unknown feed id${b.ignored.length === 1 ? "" : "s"}: ${b.ignored
                .map((i) => (i.reason === "unknown feed_id" ? i.feed_id : `${i.feed_id} (not in its status set)`))
                .join(", ")}`}
            </div>
          )}
          <table className="mt-4 w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Feed</th>
                <th className="py-1 pr-3 font-medium">State</th>
                <th className="py-1 pr-3 font-medium">Symbol</th>
                <th className="py-1 pr-3 font-medium">Last tick</th>
                <th className="py-1 font-medium">Measured by {b.name}</th>
              </tr>
            </thead>
            {b.feeds.map((f) => (
              <tbody key={f.tierKey} data-feed={f.tierKey} className="border-t border-zinc-800">
                <tr>
                  <td className="py-1 pr-3 text-zinc-200">
                    {f.name} <span className="text-zinc-500">({f.tierKey})</span>
                  </td>
                  <td className="py-1 pr-3" data-badge={f.badge.kind}>
                    <Pill kind={f.badge.kind} label={f.badge.label} />
                    {f.badge.detail ? <span className="ml-1.5 text-zinc-500">{f.badge.detail}</span> : null}
                  </td>
                  <td className="py-1 pr-3 text-zinc-500" colSpan={3}>
                    {f.rows.length === 0 ? "" : `${f.rows.length} symbol${f.rows.length === 1 ? "" : "s"}`}
                  </td>
                </tr>
                {f.rows.map((r) => (
                  <tr key={r.symbol} className="text-zinc-400">
                    <td className="py-0.5 pr-3" />
                    <td className="py-0.5 pr-3">
                      <Pill kind={r.effective.kind} label={r.effective.label} />
                      {r.effective.detail ? <span className="ml-1.5 text-zinc-500">{r.effective.detail}</span> : null}
                    </td>
                    <td className="py-0.5 pr-3 font-mono">{`${r.symbol} via ${r.source}`}</td>
                    <td className="py-0.5 pr-3">{r.lastTickAt ? formatAbsoluteUtc(r.lastTickAt) : "—"}</td>
                    <td className="py-0.5">{metrics(r)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </section>
      ))}

      {polls.length > 0 && (
        <section className="rounded-xl border border-zinc-800 p-5">
          <h2 className="text-sm font-medium text-zinc-300">Allowlist boxes</h2>
          <p className="mt-1 text-xs text-zinc-500">A poll shows the box is reachable, not that its feed is flowing.</p>
          <ul className="mt-2 space-y-1 text-xs text-zinc-400">
            {polls.map((p) => (
              <li key={p.name} data-box-poll={p.name}>
                <span className="text-zinc-200">{p.name}</span>
                {`: Box reporting · last poll ${p.lastSeenAt ? `${formatAbsoluteUtc(p.lastSeenAt)} (${formatRelative(p.lastSeenAt)})` : "never"}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
