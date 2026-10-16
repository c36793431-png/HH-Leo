import { READ_CAP, type ClientCounts, type EventKind, type EventsSummary, type ResolvedEvent } from "@/lib/feed-box-events";
import type { boxFreshness } from "@/lib/feed-status";
import { formatAbsoluteUtc, formatAbsoluteUtcSeconds } from "@/lib/format-time";

/** A box's events: the 24 h line, the newest 50 non-client events (plan m70009 U1, marcus m70721) and the 24 h client
 * counts. The wording helpers are exported for the provider page (S2) so both say the same thing. No client identifier
 * is shown (marcus m70015 Q3). */

export const KIND_LABEL: Record<EventKind, string> = {
  databento_silent: "Databento silent",
  databento_error: "Databento error",
  reconnect_ok: "Reconnected",
  bridge_start: "Bridge started",
  bridge_stop: "Bridge stopped",
  client_reject: "Client rejected",
  client_connect: "Client connected",
  client_disconnect: "Client disconnected",
};

/** FOC13's codes per kind (via marcus m70036). The route enforces only the shape, so an unlisted code renders raw. */
const DETAIL_LABEL: Record<string, string> = {
  after_silence: "after silence",
  after_error: "after error",
  initial: "initial",
  log_line: "from log line",
  uptime_reset: "uptime reset",
  process_gone: "process gone",
  b_fix: "B FIX",
  ctrader_fix: "cTrader FIX",
  ip_not_allowlisted: "IP not allowlisted",
  subscription_expired: "subscription expired",
  logon_rejected: "logon rejected",
  licence_auth: "licence / auth",
  gateway: "gateway",
  other: "other",
};

export const detailLabel = (code: string | null) => (code === null ? "" : (DETAIL_LABEL[code] ?? code));

export function formatDuration(s: number): string {
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

export function cutText(e: ResolvedEvent): string {
  const c = e.cut;
  if (!c) return "";
  if (c.state === "closed") return formatDuration(c.seconds!);
  if (c.state === "open") return `dark now · ${formatDuration(c.seconds!)}${c.capped ? "+" : ""} so far`;
  if (c.state === "ended_unknown") return `closed, duration unknown (${KIND_LABEL[c.endedBy!.kind]} ${formatAbsoluteUtcSeconds(c.endedBy!.ts)})`;
  return "cut not closed by the sender";
}

/** "0 cuts" must never read green for a silent box: off the v1 clock the line says events may be missing. */
export function summaryLine(s: EventsSummary, freshness: ReturnType<typeof boxFreshness>): string[] {
  const parts = [`Last 24 h: ${s.cuts} cut${s.cuts === 1 ? "" : "s"} started`];
  if (s.cuts > 0) parts.push(`${formatDuration(s.darkS)} dark`);
  if (s.longestS !== null) parts.push(`longest ${formatDuration(s.longestS)}`);
  if (s.noDuration > 0) parts.push(`${s.noDuration} ended without a duration`);
  if (s.errors > 0) parts.push(`${s.errors} Databento error${s.errors === 1 ? "" : "s"}`);
  if (s.open) parts.push(`dark now, since ${formatAbsoluteUtcSeconds(s.open.ts)}`);
  if (s.partial) parts.push(`counted from the newest ${READ_CAP.toLocaleString("en-US")} events only, so at least this many`);
  const lines = [parts.join(" · ")];
  if (freshness.kind !== "fresh") {
    lines.push(
      freshness.since
        ? `box silent since ${formatAbsoluteUtc(freshness.since)}: events after that are unknown`
        : "box has never sent a status report: events may be missing"
    );
  }
  return lines;
}

export const RECENT_EVENTS = 50;

/** The table lists no client_* event (loadBoxEvents doesn't read them, marcus m70721); this line counts them instead. */
export const NO_LISTED_EVENTS = "No Databento or bridge events received";

export function clientLine(c: ClientCounts): string {
  const n = (v: number) => v.toLocaleString("en-US");
  return `Last 24 h, client connects / disconnects / rejects: ${n(c.connect)} / ${n(c.disconnect)} / ${n(c.reject)} (counted, not listed)`;
}

export function BoxEvents({
  resolved,
  summary,
  freshness,
  clients,
}: {
  resolved: ResolvedEvent[];
  summary: EventsSummary;
  freshness: ReturnType<typeof boxFreshness>;
  clients: ClientCounts;
}) {
  const [line, silence] = summaryLine(summary, freshness);
  return (
    <div className="mt-4 border-t border-zinc-800 pt-3" data-box-events="">
      <div className="text-xs text-zinc-300" data-events-summary="">
        {line}
      </div>
      {silence ? (
        <div className="mt-0.5 text-xs text-amber-300" data-events-silence="">
          {silence}
        </div>
      ) : null}
      <h3 className="mt-3 text-xs font-medium text-zinc-400">Recent events</h3>
      {resolved.length === 0 ? (
        <p className="mt-1 text-xs text-zinc-500">{NO_LISTED_EVENTS}</p>
      ) : (
        <table className="mt-1 w-full text-left text-xs">
          <tbody>
            {resolved.slice(0, RECENT_EVENTS).map((e) => (
              <tr key={`${e.ts.toISOString()} ${e.kind}`} data-event={e.kind} data-cut={e.cut?.state ?? ""} className="text-zinc-400">
                <td className="py-0.5 pr-3 font-mono">{formatAbsoluteUtcSeconds(e.ts)}</td>
                <td className="py-0.5 pr-3 text-zinc-200">{KIND_LABEL[e.kind]}</td>
                <td className={`py-0.5 pr-3 ${e.cut?.state === "open" ? "text-red-300" : ""}`}>{cutText(e)}</td>
                <td className="py-0.5">{detailLabel(e.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-1 text-xs text-zinc-500" data-events-clients="">
        {clientLine(clients)}
      </div>
    </div>
  );
}
