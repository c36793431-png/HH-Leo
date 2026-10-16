import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { KIND_LABEL, RECENT_EVENTS, cutText, detailLabel, summaryLine } from "@/components/feed/box-events";
import { loadBoxEvents, providerBoxIds, resolveEvents, summarize24h } from "@/lib/feed-box-events";
import { boxFreshness, latestUpTickAt, listFeedStatus } from "@/lib/feed-status";
import { formatAbsoluteUtc, formatAbsoluteUtcSeconds, formatRelative } from "@/lib/format-time";

/** S2 of the CME feed-health events plan (m70008; rulings m70015 Q3/Q4/Q6, BUILD GO m70609): a provider sees the boxes
 * that carry ONLY their tiers (providerBoxIds, U3 + Fable m70029 S1), each with a freshness pill, the 24 h line and the
 * newest 50 events. Every word comes from box-events.tsx, so this page and /admin/feed-health say the same thing. The
 * admin-only parts (per-symbol rows and metrics, collector version, skipped events, allowlist polls) are not read here,
 * and no client is identified, only the closed code (Q3). Uptime, latency and tick rate stay unmeasured. */
export const dynamic = "force-dynamic";

const FRESHNESS: Record<ReturnType<typeof boxFreshness>["kind"], { cls: string; label: string }> = {
  fresh: { cls: "active", label: "Live" },
  unknown: { cls: "review", label: "Unknown" },
  no_report: { cls: "lapsed", label: "No report" },
};

const NOT_MEASURED = [
  { icon: "◇", label: "Uptime · 30d" },
  { icon: "◷", label: "Median tick latency" },
  { icon: "▤", label: "Tick rate · now" },
];

export default async function FeedHealthPage() {
  const session = await auth();
  const now = new Date();
  const ids = new Set(await providerBoxIds(session!.user!.id!));
  const boxes = ids.size === 0 ? [] : (await listFeedStatus(now)).filter((b) => ids.has(b.id));
  const events = await loadBoxEvents(boxes.map((b) => b.id), now);
  const cards = boxes.map((b) => {
    const { events: list, truncatedBefore } = events.get(b.id)!;
    const resolved = resolveEvents(list, { latestUpTickAt: latestUpTickAt(b) }, now);
    const freshness = boxFreshness(b.statusReportedAt, now);
    const [line, silence] = summaryLine(summarize24h(resolved, now, truncatedBefore), freshness);
    return { box: b, resolved, freshness, line, silence };
  });

  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>Feed Health</h1>
          <div className="crumb">feed.horizonhft.com / health</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        <div className="banner info">
          <span className="bic">◇</span>
          <div>
            Your box&apos;s bridge log: Databento cuts and errors, bridge restarts, client connects and rejects, kept 30
            days. Times are UTC. Uptime and latency are not measured yet.
          </div>
        </div>

        <div className="stats three">
          {NOT_MEASURED.map((s) => (
            <div className="stat" key={s.label}>
              <div className="lab">
                <span className="si">{s.icon}</span> {s.label}
              </div>
              <div className="val">
                — <small>not measured</small>
              </div>
            </div>
          ))}
        </div>

        {cards.length === 0 && (
          <div className="card full">
            <div className="empty" data-feed-health-empty="">
              <div className="eic">◇</div>
              <b>Nothing reported yet</b>
              <p>A box that serves only your feeds shows here once its bridge sends a status report or an event.</p>
            </div>
          </div>
        )}

        {cards.map(({ box, resolved, freshness, line, silence }) => (
          <section key={box.id} className="card full" data-box={box.name}>
            <div className="chead">
              <span className="ic">◇</span>
              <h3>{box.name}</h3>
              <span className={`tb ${FRESHNESS[freshness.kind].cls}`} data-freshness={freshness.kind}>
                {FRESHNESS[freshness.kind].label}
              </span>
              <span className="cap">
                {`last report ${box.statusReportedAt ? `${formatAbsoluteUtc(box.statusReportedAt)} (${formatRelative(box.statusReportedAt)})` : "never"}`}
              </span>
            </div>
            <div className="scope-note" data-events-summary="">
              <span className="i">◈</span>
              <span>{line}</span>
            </div>
            {silence ? (
              <div className="scope-note" data-events-silence="">
                <span className="i">!</span>
                <span className="muted">{silence}</span>
              </div>
            ) : null}
            {resolved.length === 0 ? (
              <div className="empty">
                <b>No events received</b>
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Duration</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {resolved.slice(0, RECENT_EVENTS).map((e) => (
                    <tr key={`${e.ts.toISOString()} ${e.kind}`} data-event={e.kind} data-cut={e.cut?.state ?? ""}>
                      <td className="mono">{formatAbsoluteUtcSeconds(e.ts)}</td>
                      <td>{KIND_LABEL[e.kind]}</td>
                      <td className={e.cut?.state === "open" ? "dark-now" : undefined}>{cutText(e)}</td>
                      <td>{detailLabel(e.detail)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}

        <div className="foot">HORIZON HFT · provider panel · Feed Health</div>
      </section>
    </>
  );
}
