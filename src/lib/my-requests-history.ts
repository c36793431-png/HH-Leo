import { pool } from "./db";
import { basketReference, listBasketRequests, type BasketRequestRow } from "./basket-requests";
import { listAccessRequests, type AccessRequestRow } from "./access-requests";
import { feedTierMeta } from "./feed-tier-catalogue";

/**
 * "My requests" history (coxwell 14:06Z via marcus m59959 (B); scope m59978, build go + rulings
 * m59979): everything one client has asked for or holds, newest first, in ONE status vocabulary.
 * Read-only. Each source keeps its own reader below; the page merges them in JS, not a SQL UNION,
 * because every source words its status differently.
 *
 * Sources (m59979): basket_requests; access_requests grouped by batch_id (one row per click);
 * legacy feed_tier_requests rows that have NO envelope (0086 section 3 copied the rest; prod had
 * one such row on 10-04, m59979 (d)); feed_requests; strategy_requests; strategy_submissions;
 * feed_tier_trials that have no envelope; black_trials; licences (active, expired and revoked).
 * Payments are out (m59979 (b)). A grant is the OUTCOME on its request row, never a second row.
 */

export const HISTORY_STATUSES = ["Sent", "In review", "Approved", "Declined", "Handled", "Active", "Ended"] as const;
export type HistoryStatus = (typeof HISTORY_STATUSES)[number];

export type HistorySource =
  | "basket"
  | "access"
  | "legacy_tier_request"
  | "feed_request"
  | "strategy_request"
  | "strategy_submission"
  | "feed_trial"
  | "black_trial"
  | "licence";

export interface HistoryRow {
  /** Stable React key: source + row id. */
  key: string;
  source: HistorySource;
  at: Date;
  /** What it was, e.g. "Basket request", "Feed access", "Horizon licence". */
  kind: string;
  /** The items asked for or held: basket lines, tier names, or one cut-down free-text line. */
  items: string[];
  /** One small status per item, same order (a mixed click: m59992); absent when the row's own
   * status says it all. */
  itemStatuses?: string[];
  status: HistoryStatus;
  /** The outcome under the status, e.g. "Trial until 3 Nov 2026"; null when there is none. */
  outcome: string | null;
  reference: string;
}

/** Free text is the client's own words, cut down (m59979 (c)). */
export const HISTORY_TEXT_MAX = 80;
export function cutText(text: string, max = HISTORY_TEXT_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function tierName(tierKey: string | null, fallback: string | null): string {
  return (tierKey ? feedTierMeta(tierKey)?.name : null) ?? fallback ?? tierKey ?? "Feed tier";
}

// ---- pure mappers (unit-tested in my-requests-history.test.ts) ----

export function basketHistoryRow(r: BasketRequestRow): HistoryRow {
  return {
    key: `basket:${r.id}`,
    source: "basket",
    at: r.submittedAt,
    kind: "Basket request",
    items: [
      ...r.lines.map((l) => (l.kind === "feed" ? `${l.name} · ${l.servers ?? 1} server${(l.servers ?? 1) === 1 ? "" : "s"}` : l.name)),
      ...(r.hasTrial ? ["Start with a 30-day trial"] : []),
    ],
    status: r.status === "handled" ? "Handled" : "Sent",
    // The basket's own lines, unchanged from the basket-only page.
    outcome: r.status === "handled" ? "We've replied. See your email for what was agreed." : "We have it. We'll confirm by email.",
    reference: r.reference,
  };
}

/** An approved envelope's decision, e.g. "Trial until 3 Nov 2026"; null when it isn't approved. */
function accessOutcome(r: AccessRequestRow, now: Date): string | null {
  if (r.status !== "approved") return null;
  const what = r.decision === "trial" ? "Trial" : r.decision === "paid" ? "Access" : "Approved";
  return r.endsAt ? `${what} ${r.endsAt > now ? "until" : "ended"} ${fmtDate(r.endsAt)}` : r.decision ? what : null;
}

/** One envelope's own status, e.g. "Approved, trial until 3 Nov 2026" or "Sent". */
function accessLineStatus(r: AccessRequestRow, now: Date): string {
  if (r.status === "pending") return "Sent";
  if (r.status === "rejected") return "Declined";
  const outcome = accessOutcome(r, now);
  return outcome && outcome !== "Approved" ? `Approved, ${outcome[0].toLowerCase()}${outcome.slice(1)}` : "Approved";
}

/** One row per click: every envelope sharing a batch_id. Pending anywhere = still Sent; else
 * Approved if any line was approved; else Declined. The decision (trial/paid + end) is the outcome.
 * When the lines differ (one pending and one approved, or two different decisions), each tier gets
 * its own small status and the row has no single outcome, so an approved tier is never hidden
 * behind "Sent" (m59992). */
export function accessHistoryRows(rows: AccessRequestRow[], now: Date = new Date()): HistoryRow[] {
  const batches = new Map<string, AccessRequestRow[]>();
  for (const r of rows) {
    if (!batches.has(r.batchId)) batches.set(r.batchId, []);
    batches.get(r.batchId)!.push(r);
  }
  return [...batches.values()].map((batch) => {
    const first = batch.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
    const status: HistoryStatus = batch.some((r) => r.status === "pending")
      ? "Sent"
      : batch.some((r) => r.status === "approved")
        ? "Approved"
        : "Declined";
    const lineStatuses = batch.map((r) => accessLineStatus(r, now));
    const mixed = new Set(lineStatuses).size > 1;
    const approved = batch.find((r) => r.status === "approved");
    const outcome = !mixed && status === "Approved" && approved ? accessOutcome(approved, now) : null;
    return {
      key: `access:${first.batchId}`,
      source: "access" as const,
      at: first.createdAt,
      kind: first.productKind === "software" ? "Software access" : "Feed access",
      items: batch.map((r) => tierName(r.tierKey, r.tierName ?? r.productId)),
      ...(mixed ? { itemStatuses: lineStatuses } : {}),
      status,
      outcome,
      reference: basketReference(first.batchId),
    };
  });
}

export interface LegacyTierRequestRecord {
  id: string;
  tierKey: string;
  status: "pending" | "approved" | "rejected" | "provisioned";
  createdAt: Date;
}
export function legacyTierHistoryRow(r: LegacyTierRequestRecord): HistoryRow {
  return {
    key: `legacy:${r.id}`,
    source: "legacy_tier_request",
    at: r.createdAt,
    kind: "Feed access",
    items: [tierName(r.tierKey, null)],
    status: r.status === "pending" ? "Sent" : r.status === "rejected" ? "Declined" : "Approved",
    outcome: null,
    reference: basketReference(r.id),
  };
}

export interface IdeaRecord {
  id: string;
  text: string;
  status: string;
  at: Date;
}
export function feedRequestHistoryRow(r: IdeaRecord): HistoryRow {
  const status: HistoryStatus =
    r.status === "new" ? "Sent" : r.status === "reviewing" ? "In review" : r.status === "declined" ? "Declined" : "Approved";
  return {
    key: `feedreq:${r.id}`,
    source: "feed_request",
    at: r.at,
    kind: "New feed request",
    items: [cutText(r.text)],
    status,
    outcome: r.status === "shipped" ? "Shipped" : null,
    reference: basketReference(r.id),
  };
}
export function strategyRequestHistoryRow(r: IdeaRecord): HistoryRow {
  const status: HistoryStatus =
    r.status === "new"
      ? "Sent"
      : r.status === "reviewing" || r.status === "scoping"
        ? "In review"
        : r.status === "declined"
          ? "Declined"
          : "Approved";
  return {
    key: `stratreq:${r.id}`,
    source: "strategy_request",
    at: r.at,
    kind: "Strategy idea",
    items: [cutText(r.text)],
    status,
    outcome: r.status === "shipped" ? "Shipped" : r.status === "scoping" ? "Being scoped" : null,
    reference: basketReference(r.id),
  };
}
export function strategySubmissionHistoryRow(r: IdeaRecord): HistoryRow {
  const status: HistoryStatus =
    r.status === "pending"
      ? "Sent"
      : r.status === "under_review" || r.status === "approved_draft"
        ? "In review"
        : r.status === "listed"
          ? "Approved"
          : r.status === "declined"
            ? "Declined"
            : "Ended";
  return {
    key: `stratsub:${r.id}`,
    source: "strategy_submission",
    at: r.at,
    kind: "Your strategy",
    items: [cutText(r.text)],
    status,
    outcome: r.status === "listed" ? "Listed" : r.status === "withdrawn" ? "Withdrawn" : null,
    reference: basketReference(r.id),
  };
}

export interface TrialRecord {
  id: string;
  tierKey: string;
  status: "active" | "expired" | "converted" | "cancelled";
  startedAt: Date;
  endsAt: Date;
}
export function feedTrialHistoryRow(r: TrialRecord, now: Date = new Date()): HistoryRow {
  const live = r.status === "active" && r.endsAt > now;
  return {
    key: `trial:${r.id}`,
    source: "feed_trial",
    at: r.startedAt,
    kind: "Feed trial",
    items: [tierName(r.tierKey, null)],
    status: live ? "Active" : "Ended",
    outcome: live
      ? `Until ${fmtDate(r.endsAt)}`
      : r.status === "converted"
        ? "Moved to paid"
        : `Ended ${fmtDate(r.endsAt < now ? r.endsAt : now)}`,
    reference: basketReference(r.id),
  };
}

export interface BlackTrialRecord {
  id: string;
  status: "requested" | "active" | "declined" | "converted";
  requestedAt: Date;
  expiresAt: Date | null;
}
export function blackTrialHistoryRow(r: BlackTrialRecord, now: Date = new Date()): HistoryRow {
  const live = r.status === "active" && (!r.expiresAt || r.expiresAt > now);
  const status: HistoryStatus =
    r.status === "requested" ? "Sent" : r.status === "declined" ? "Declined" : live ? "Active" : "Ended";
  return {
    key: `black:${r.id}`,
    source: "black_trial",
    at: r.requestedAt,
    kind: "Black trial",
    items: ["Horizon Black"],
    status,
    outcome:
      status === "Active" && r.expiresAt
        ? `Until ${fmtDate(r.expiresAt)}`
        : r.status === "converted"
          ? "Moved to paid"
          : status === "Ended" && r.expiresAt
            ? `Ended ${fmtDate(r.expiresAt)}`
            : null,
    reference: basketReference(r.id),
  };
}

export interface LicenceRecord {
  id: string;
  keyTail: string;
  tier: string;
  status: "active" | "revoked";
  issuedAt: Date;
  expiresAt: Date;
}
const LICENCE_TIER_LABEL: Record<string, string> = { trial: "Trial", paid: "Paid", team: "Team", deal: "Partner" };
export function licenceHistoryRow(r: LicenceRecord, now: Date = new Date()): HistoryRow {
  const live = r.status === "active" && r.expiresAt > now;
  return {
    key: `licence:${r.id}`,
    source: "licence",
    at: r.issuedAt,
    kind: "Horizon licence",
    items: [`${LICENCE_TIER_LABEL[r.tier] ?? r.tier} licence`],
    status: live ? "Active" : "Ended",
    outcome: r.status === "revoked" ? "Revoked" : live ? `Until ${fmtDate(r.expiresAt)}` : `Ended ${fmtDate(r.expiresAt)}`,
    reference: `Key ••••${r.keyTail}`,
  };
}

/** Newest first; ties broken by key so the order is total (two rows can share a timestamp). */
export function sortHistory(rows: HistoryRow[]): HistoryRow[] {
  return [...rows].sort((a, b) => b.at.getTime() - a.at.getTime() || a.key.localeCompare(b.key));
}

// ---- readers: every query is scoped to the one user ----

async function legacyTierRequestsWithoutEnvelope(userId: string): Promise<LegacyTierRequestRecord[]> {
  const result = await pool.query<{ id: string; tier_key: string; status: LegacyTierRequestRecord["status"]; created_at: Date }>(
    `select f.id, f.tier_key, f.status, f.created_at
     from feed_tier_requests f
     where f.user_id = $1
       and not exists (select 1 from access_requests a where a.legacy_feed_tier_request_id = f.id)`,
    [userId]
  );
  return result.rows.map((r) => ({ id: r.id, tierKey: r.tier_key, status: r.status, createdAt: r.created_at }));
}

async function feedRequestsFor(userId: string): Promise<IdeaRecord[]> {
  const result = await pool.query<{ id: string; venue_text: string; status: string; submitted_at: Date }>(
    `select id, venue_text, status, submitted_at from feed_requests where user_id = $1`,
    [userId]
  );
  return result.rows.map((r) => ({ id: r.id, text: r.venue_text, status: r.status, at: r.submitted_at }));
}

async function strategyRequestsFor(userId: string): Promise<IdeaRecord[]> {
  const result = await pool.query<{ id: string; idea_text: string; status: string; submitted_at: Date }>(
    `select id, idea_text, status, submitted_at from strategy_requests where user_id = $1`,
    [userId]
  );
  return result.rows.map((r) => ({ id: r.id, text: r.idea_text, status: r.status, at: r.submitted_at }));
}

async function strategySubmissionsFor(userId: string): Promise<IdeaRecord[]> {
  const result = await pool.query<{ id: string; name: string; status: string; created_at: Date }>(
    `select id, name, status, created_at from strategy_submissions where author_user_id = $1`,
    [userId]
  );
  return result.rows.map((r) => ({ id: r.id, text: r.name, status: r.status, at: r.created_at }));
}

/** Trials with no envelope for the same tier. Since 0086 every trial path writes an envelope
 * (admin approve, self-serve), so its trial is that row's outcome; a trial started before 0086
 * had no request and is shown on its own. */
async function feedTrialsWithoutEnvelope(userId: string): Promise<TrialRecord[]> {
  const result = await pool.query<{ id: string; tier_key: string; trial_status: TrialRecord["status"]; trial_started_at: Date; trial_ends_at: Date }>(
    `select t.id, t.tier_key, t.trial_status, t.trial_started_at, t.trial_ends_at
     from feed_tier_trials t
     where t.user_id = $1
       and not exists (
         select 1 from access_requests a
         join feed_tier_request_details d on d.request_id = a.id
         join feed_tiers ft on ft.id = d.feed_tier_id
         where a.user_id = t.user_id and ft.tier_key = t.tier_key and a.status = 'approved')`,
    [userId]
  );
  return result.rows.map((r) => ({ id: r.id, tierKey: r.tier_key, status: r.trial_status, startedAt: r.trial_started_at, endsAt: r.trial_ends_at }));
}

async function blackTrialsFor(userId: string): Promise<BlackTrialRecord[]> {
  const result = await pool.query<{ id: string; status: BlackTrialRecord["status"]; requested_at: Date; expires_at: Date | null }>(
    `select id, status, requested_at, expires_at from black_trials where user_id = $1`,
    [userId]
  );
  return result.rows.map((r) => ({ id: r.id, status: r.status, requestedAt: r.requested_at, expiresAt: r.expires_at }));
}

/** Every licence the user holds or held: active, expired and revoked (m59979 (a)). Only the key's
 * last 4 characters leave this function. */
async function licencesFor(userId: string): Promise<LicenceRecord[]> {
  const result = await pool.query<{ id: string; key_tail: string; tier: string; status: LicenceRecord["status"]; issued_at: Date; expires_at: Date }>(
    `select id, right(license_key, 4) as key_tail, tier, status, issued_at, expires_at from licenses where user_id = $1`,
    [userId]
  );
  return result.rows.map((r) => ({ id: r.id, keyTail: r.key_tail, tier: r.tier, status: r.status, issuedAt: r.issued_at, expiresAt: r.expires_at }));
}

/** A source that fails is left out rather than failing the page; the page says so. */
export async function listMyRequestsHistory(userId: string): Promise<{ rows: HistoryRow[]; failedSources: HistorySource[] }> {
  const failed: HistorySource[] = [];
  const safe = <T,>(source: HistorySource, p: Promise<T[]>): Promise<T[]> =>
    p.catch((err) => {
      console.error(`listMyRequestsHistory: ${source} failed`, err);
      failed.push(source);
      return [];
    });
  const now = new Date();
  const [basket, access, legacy, feedReqs, stratReqs, stratSubs, trials, black, licences] = await Promise.all([
    safe("basket", listBasketRequests({ userId })),
    safe("access", listAccessRequests({ userId })),
    safe("legacy_tier_request", legacyTierRequestsWithoutEnvelope(userId)),
    safe("feed_request", feedRequestsFor(userId)),
    safe("strategy_request", strategyRequestsFor(userId)),
    safe("strategy_submission", strategySubmissionsFor(userId)),
    safe("feed_trial", feedTrialsWithoutEnvelope(userId)),
    safe("black_trial", blackTrialsFor(userId)),
    safe("licence", licencesFor(userId)),
  ]);
  const rows = sortHistory([
    ...basket.map(basketHistoryRow),
    ...accessHistoryRows(access, now),
    ...legacy.map(legacyTierHistoryRow),
    ...feedReqs.map(feedRequestHistoryRow),
    ...stratReqs.map(strategyRequestHistoryRow),
    ...stratSubs.map(strategySubmissionHistoryRow),
    ...trials.map((t) => feedTrialHistoryRow(t, now)),
    ...black.map((b) => blackTrialHistoryRow(b, now)),
    ...licences.map((l) => licenceHistoryRow(l, now)),
  ]);
  return { rows, failedSources: failed };
}
