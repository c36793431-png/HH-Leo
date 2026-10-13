import { pool, type Db } from "./db";
import type { SignalStatsRow } from "./signal-stats";

/** The page's one read query (Axiom signals dashboard S4, marcus GO m67643; plan
 * docs/specs/axiom-signals-dashboard-plan.md section 5 at d52245c, :340 and :350-353). Reads only.
 *
 * Fable's S3 notes (m67641, ruled requirements by marcus m67643), each met in the SELECT, not by the driver:
 * - move is the numeric's TEXT (`move::text`), never a float cast, so signal-stats' moveMicros sums it exactly;
 * - entry_ts / exit_ts / received_at / entry_px_at come back as Date objects (toRow wraps each in new Date);
 * - now is not read here: the page takes ONE new Date() per request and passes it to signalStats.
 * session_date is projected as text too: node-postgres parses a bare `date` into a local-midnight Date.
 * sender_label = meta->>'source' is the only source-specific key read, and no number keys on it (fable N5
 * m67474, plan :350-353). Only 'card' / 'backfill' pass through, anything else is null (S4.1, fable VERDICT-S4 S1
 * m67678): 0110 has no CHECK on meta, and signal-stats tally() counts labels[senderLabel ?? "none"], so a raw
 * off-enum value would drop the row out of card / backfill / none. The query is the boundary; signal-stats is unchanged. */

export interface SignalCallsFilter {
  source: string;
  /** YYYY-MM-DD, inclusive; null = no bound. */
  from: string | null;
  to: string | null;
}

const SOURCE_RE = /^[a-z][a-z0-9-]{1,31}$/; // 0110's source CHECK
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date only: "2026-02-30" would make the ::date cast throw, so it reads as no bound. */
const isoDate = (s: string | undefined) =>
  s && DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s) ? s : null;

/** `?source=axiom&from=YYYY-MM-DD&to=YYYY-MM-DD` (plan :340); default source axiom, all dates. */
export function parseSignalCallsFilter(sp: { source?: string; from?: string; to?: string }): SignalCallsFilter {
  return {
    source: sp.source && SOURCE_RE.test(sp.source) ? sp.source : "axiom",
    from: isoDate(sp.from),
    to: isoDate(sp.to),
  };
}

interface RawRow {
  symbol: string;
  session_date: string;
  direction: SignalStatsRow["direction"];
  entry_ts: Date | string;
  exit_ts: Date | string;
  received_at: Date | string;
  entry_px_at: Date | string | null;
  outcome: SignalStatsRow["outcome"];
  move: string | null;
  sender_label: SignalStatsRow["senderLabel"];
}

const toRow = (r: RawRow): SignalStatsRow => ({
  symbol: r.symbol,
  sessionDate: r.session_date,
  direction: r.direction,
  entryTs: new Date(r.entry_ts),
  exitTs: new Date(r.exit_ts),
  receivedAt: new Date(r.received_at),
  entryPxAt: r.entry_px_at === null ? null : new Date(r.entry_px_at),
  outcome: r.outcome,
  move: r.move,
  senderLabel: r.sender_label,
});

export async function listSignalCallsOn(db: Db, f: SignalCallsFilter): Promise<SignalStatsRow[]> {
  const { rows } = await db.query(
    `select symbol, session_date::text as session_date, direction, entry_ts, exit_ts, received_at, entry_px_at,
            outcome, move::text as move,
            case when meta->>'source' in ('card', 'backfill') then meta->>'source' end as sender_label
     from signal_calls
     where source = $1
       and ($2::date is null or session_date >= $2::date)
       and ($3::date is null or session_date <= $3::date)
     order by session_date, symbol`,
    [f.source, f.from, f.to]
  );
  return (rows as RawRow[]).map(toRow);
}

export const listSignalCalls = (f: SignalCallsFilter) => listSignalCallsOn(pool, f);
