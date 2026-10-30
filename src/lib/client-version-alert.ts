import { pool } from "./db";
import { getLatestDownloads } from "./downloads";
import { clientNumberSql } from "./licenses";
import { notifyOldClientVersions } from "./telemetry-sink";

/**
 * Daily "which clients run an old Horizon build" note to coxwell (marcus m80072, 2026-10-30), built on
 * client_heartbeats. One Telegram message, only when there is something to say; no client is messaged.
 *
 * It is only as live as the heartbeat pipe. client_heartbeats stopped filling on 2026-10-18 (Upstash cap) and an
 * empty 7-day window would have read as "everyone is current". So when the newest last_seen in the whole table
 * is older than STALE_AFTER_HOURS the message says the pipe is stale instead of listing anything.
 */

export const ACTIVE_WINDOW_DAYS = 7;
export const STALE_AFTER_HOURS = 36;
/** Telegram caps a message at 4096 chars; a line is ~70, so this leaves room for the header and footer. */
const MAX_LISTED = 40;
const MAX_VERSION_SHOWN = 24;
const MAX_NAME_SHOWN = 40;

export type ParsedVersion = { kind: "release"; parts: number[] } | { kind: "dev" } | { kind: "unrecognised" };

/**
 * Dotted numeric segments compared with zero padding (2.0.10 > 2.0.9, 2.2 = 2.2.0), a leading V/v stripped.
 * Reported versions are client-supplied text on an unauthenticated endpoint, so anything that is not plainly
 * a release is "unrecognised" and never called old:
 *  - "-dev" suffix (or any non-numeric suffix) -> dev / unrecognised, not compared;
 *  - fewer than two segments ("2"): every shipped build is major.minor at least;
 *  - a segment with a leading zero ("V2.02"): could be 2.0.2 or 2.2, and guessing 2.2 would call a stale build current.
 */
export function parseVersion(raw: string | null | undefined): ParsedVersion {
  const s = (raw ?? "").trim().replace(/^v/i, "");
  if (/^\d+(\.\d+)*-dev$/i.test(s)) return { kind: "dev" };
  if (!/^\d+(\.\d+)+$/.test(s)) return { kind: "unrecognised" };
  const segments = s.split(".");
  if (segments.some((p) => p.length > 1 && p.startsWith("0"))) return { kind: "unrecognised" };
  const parts = segments.map(Number);
  if (parts.some((n) => !Number.isSafeInteger(n))) return { kind: "unrecognised" };
  return { kind: "release", parts };
}

export function compareParts(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** One (client, version) pair out of client_heartbeats: the newest last_seen across that client's rows with it. */
export interface HeartbeatVersionRow {
  /** users.id, or null for a licence with no user. */
  userId: string | null;
  licenseId: string | null;
  clientVersion: string | null;
  lastSeen: Date;
  displayName: string | null;
  /** clientNumberSql: null for an internal/test account (not a client; left out). */
  clientNumber: number | null;
}

export type AlertPlan =
  | { send: false; reason: "all_current" }
  | { send: true; reason: "stale" | "check_skipped"; text: string }
  | { send: true; reason: "old_versions"; text: string; behind: number; active: number };

const mmddhhmm = (d: Date) => `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 16)}Z`;

/** Control characters and newlines out, length capped: the version string and display name are user-controlled. */
function clean(text: string, max: number): string {
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function who(r: HeartbeatVersionRow): string {
  const name = r.displayName ? clean(r.displayName, MAX_NAME_SHOWN) : "";
  if (r.clientNumber !== null) return `Client #${r.clientNumber}${name ? ` ${name}` : ""}`;
  return `Unlinked licence ${(r.licenseId ?? "unknown").slice(0, 8)}`;
}

const sortKey = (r: HeartbeatVersionRow) => (r.clientNumber !== null ? r.clientNumber : Number.MAX_SAFE_INTEGER);
const clientId = (r: HeartbeatVersionRow) => r.userId ?? `lic:${r.licenseId}`;

const FOOTER = "Counts clients with a trading tab running; an app left open with no tab running sends nothing.";

/**
 * Pure: rows + latest release + clock in, decision and message out. No licence key, hwid or IP is ever in the text.
 * `newestLastSeen` is over the WHOLE table (not the 7-day window), for the dead-man check.
 */
export function planAlert(opts: {
  rows: HeartbeatVersionRow[];
  newestLastSeen: Date | null;
  latestVersion: string | null;
  now: Date;
}): AlertPlan {
  const { rows, newestLastSeen, latestVersion, now } = opts;

  if (!newestLastSeen || now.getTime() - newestLastSeen.getTime() > STALE_AFTER_HOURS * 3_600_000) {
    return {
      send: true,
      reason: "stale",
      text:
        (newestLastSeen
          ? `Heartbeats stale since ${mmddhhmm(newestLastSeen)}; version list unreliable.`
          : "No heartbeats recorded at all; version list unreliable.") +
        `\nThe alert reads client_heartbeats, which fills from the daily flush of the beat buffer.`,
    };
  }

  const latest = latestVersion ? parseVersion(latestVersion) : null;
  if (!latest || latest.kind !== "release") {
    // Nothing to compare against: say so rather than staying silent about a check that did not run.
    return {
      send: true,
      reason: "check_skipped",
      text: `Old-version check skipped: no published release with a comparable version (got ${clean(latestVersion ?? "none", MAX_VERSION_SHOWN)}).`,
    };
  }

  // One entry per (client, version): a client with two licences or two machines on the same build is one line.
  const merged = new Map<string, HeartbeatVersionRow>();
  for (const r of rows) {
    const k = `${clientId(r)}|${r.clientVersion ?? ""}`;
    const seen = merged.get(k);
    if (!seen || r.lastSeen > seen.lastSeen) merged.set(k, r);
  }

  const cutoff = now.getTime() - ACTIVE_WINDOW_DAYS * 86_400_000;
  const recent = [...merged.values()].filter((r) => r.lastSeen.getTime() > cutoff && (r.userId === null || r.clientNumber !== null));
  const activeClients = new Set(recent.map(clientId));
  const notSeen = new Set(
    [...merged.values()].filter((r) => r.lastSeen.getTime() <= cutoff && (r.userId === null || r.clientNumber !== null)).map(clientId)
  );
  for (const id of activeClients) notSeen.delete(id);

  const old: HeartbeatVersionRow[] = [];
  const other: { row: HeartbeatVersionRow; label: string }[] = [];
  for (const r of recent) {
    const v = parseVersion(r.clientVersion);
    if (v.kind === "release") {
      if (compareParts(v.parts, latest.parts) < 0) old.push(r);
    } else {
      const shown = r.clientVersion ? clean(r.clientVersion, MAX_VERSION_SHOWN) : "none reported";
      other.push({ row: r, label: v.kind === "dev" ? `${shown} (dev build)` : `${shown} (unrecognised)` });
    }
  }
  if (old.length === 0 && other.length === 0) return { send: false, reason: "all_current" };

  old.sort((a, b) => sortKey(a) - sortKey(b) || a.lastSeen.getTime() - b.lastSeen.getTime());
  other.sort((a, b) => sortKey(a.row) - sortKey(b.row));
  const behind = new Set(old.map(clientId)).size;

  const line = (r: HeartbeatVersionRow, version: string) =>
    `• ${who(r)}, ${version}, last seen ${mmddhhmm(r.lastSeen)}`;
  const lines: string[] = [];
  for (const r of old.slice(0, MAX_LISTED)) lines.push(line(r, clean(r.clientVersion ?? "", MAX_VERSION_SHOWN)));
  if (old.length > MAX_LISTED) lines.push(`…and ${old.length - MAX_LISTED} more.`);

  const out = [`Old Horizon versions (latest ${clean(latestVersion!, MAX_VERSION_SHOWN)}, seen in the last ${ACTIVE_WINDOW_DAYS} days)`];
  out.push(...(lines.length ? lines : ["• none behind the latest release"]));
  if (other.length > 0) {
    out.push("Not compared (dev or unrecognised version strings):");
    out.push(...other.slice(0, MAX_LISTED).map((o) => line(o.row, o.label)));
    if (other.length > MAX_LISTED) out.push(`…and ${other.length - MAX_LISTED} more.`);
  }
  out.push(`${behind} of ${activeClients.size} active clients are behind. Not seen in ${ACTIVE_WINDOW_DAYS} days: ${notSeen.size} (not listed).`);
  out.push(FOOTER);
  return { send: true, reason: "old_versions", text: out.join("\n"), behind, active: activeClients.size };
}

/** Newest published version across platforms (the /admin/downloads and download-page selector), or null. */
async function latestPublishedVersion(): Promise<string | null> {
  const latest = await getLatestDownloads();
  let best: { version: string; parts: number[] } | null = null;
  for (const row of Object.values(latest)) {
    if (!row) continue;
    const v = parseVersion(row.version);
    if (v.kind === "release" && (!best || compareParts(v.parts, best.parts) > 0)) best = { version: row.version, parts: v.parts };
  }
  return best?.version ?? null;
}

export interface AlertRunResult {
  sent: boolean;
  reason: AlertPlan["reason"];
  behind?: number;
  active?: number;
}

/** One read of client_heartbeats (one row per licence key + hwid, so small), one send. Throws if the send fails. */
export async function runClientVersionAlert(now = new Date()): Promise<AlertRunResult> {
  const res = await pool.query(
    `select h.user_id, h.license_id, h.client_version, max(h.last_seen) as last_seen,
            u.display_name, ${clientNumberSql("u")} as client_number
       from client_heartbeats h
       left join users u on u.id = h.user_id
      group by h.user_id, h.license_id, h.client_version, u.id, u.display_name, u.email, u.created_at`
  );
  const rows: HeartbeatVersionRow[] = res.rows.map(
    (r: {
      user_id: string | null;
      license_id: string | null;
      client_version: string | null;
      last_seen: Date;
      display_name: string | null;
      client_number: string | number | null;
    }) => ({
      userId: r.user_id,
      licenseId: r.license_id,
      clientVersion: r.client_version,
      lastSeen: new Date(r.last_seen),
      displayName: r.display_name,
      clientNumber: r.client_number !== null ? Number(r.client_number) : null,
    })
  );
  const newestLastSeen = rows.reduce<Date | null>((m, r) => (!m || r.lastSeen > m ? r.lastSeen : m), null);

  const plan = planAlert({ rows, newestLastSeen, latestVersion: await latestPublishedVersion(), now });
  if (!plan.send) return { sent: false, reason: plan.reason };
  const ok = await notifyOldClientVersions(plan.text);
  if (!ok) throw new Error("client-version-alert: the Telegram send failed");
  return plan.reason === "old_versions"
    ? { sent: true, reason: plan.reason, behind: plan.behind, active: plan.active }
    : { sent: true, reason: plan.reason };
}
