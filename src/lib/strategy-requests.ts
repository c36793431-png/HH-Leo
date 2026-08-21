import { pool } from "./db";
import { notifyStrategyRequestSubmitted } from "./telemetry-sink";

export const STRATEGY_REQUEST_STATUSES = ["new", "reviewing", "declined", "scoping", "shipped"] as const;
export type StrategyRequestStatus = (typeof STRATEGY_REQUEST_STATUSES)[number];

export const STRATEGY_CATEGORIES = ["arbitrage", "momentum", "grid", "scalping", "custom"] as const;
export type StrategyCategory = (typeof STRATEGY_CATEGORIES)[number];

export const STRATEGY_INSTRUMENTS = ["FX majors", "Gold", "Indices", "Futures", "Crypto"] as const;
export type StrategyInstrument = (typeof STRATEGY_INSTRUMENTS)[number];

export const STRATEGY_FEED_REQUIREMENTS = ["london", "ny", "cme", "tokyo"] as const;
export type StrategyFeedRequirement = (typeof STRATEGY_FEED_REQUIREMENTS)[number];

export const STRATEGY_CONTACT_PREFERENCES = ["portal", "telegram", "email"] as const;
export type StrategyContactPreference = (typeof STRATEGY_CONTACT_PREFERENCES)[number];

export interface StrategyRequestRow {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  ideaText: string;
  assetText: string | null;
  timeframeText: string | null;
  referencesText: string | null;
  status: StrategyRequestStatus;
  adminNotes: string | null;
  submittedAt: Date;
  submissionType: "pitch" | "structured";
  strategyName: string | null;
  category: StrategyCategory | null;
  instruments: string[] | null;
  feedRequirement: StrategyFeedRequirement | null;
  contactPreference: StrategyContactPreference | null;
}

function mapRow(row: {
  id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  idea_text: string;
  asset_text: string | null;
  timeframe_text: string | null;
  references_text: string | null;
  status: string;
  admin_notes: string | null;
  submitted_at: Date;
  submission_type: string;
  strategy_name: string | null;
  category: string | null;
  instruments: string[] | null;
  feed_requirement: string | null;
  contact_preference: string | null;
}): StrategyRequestRow {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    ideaText: row.idea_text,
    assetText: row.asset_text,
    timeframeText: row.timeframe_text,
    referencesText: row.references_text,
    status: row.status as StrategyRequestStatus,
    adminNotes: row.admin_notes,
    submittedAt: row.submitted_at,
    submissionType: row.submission_type as "pitch" | "structured",
    strategyName: row.strategy_name,
    category: row.category as StrategyCategory | null,
    instruments: row.instruments,
    feedRequirement: row.feed_requirement as StrategyFeedRequirement | null,
    contactPreference: row.contact_preference as StrategyContactPreference | null,
  };
}

const SELECT_COLUMNS = `sr.id, sr.user_id, u.display_name as user_name, u.email as user_email,
       sr.idea_text, sr.asset_text, sr.timeframe_text, sr.references_text,
       sr.status, sr.admin_notes, sr.submitted_at,
       sr.submission_type, sr.strategy_name, sr.category, sr.instruments,
       sr.feed_requirement, sr.contact_preference`;

interface CreateStrategyRequestArgs {
  userId: string;
  ideaText: string;
  assetText: string | null;
  timeframeText: string | null;
  referencesText: string | null;
}

export async function createStrategyRequest(args: CreateStrategyRequestArgs): Promise<StrategyRequestRow> {
  const result = await pool.query(
    `insert into strategy_requests (user_id, idea_text, asset_text, timeframe_text, references_text)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [args.userId, args.ideaText, args.assetText, args.timeframeText, args.referencesText]
  );
  const row = await getStrategyRequest(result.rows[0].id);
  if (!row) throw new Error("failed to load created strategy request");

  notifyStrategyRequestSubmitted({
    email: row.userEmail,
    submissionType: row.submissionType,
    summary: row.ideaText,
    adminUrl: "/admin/strategy-requests",
  }).catch(() => {});

  return row;
}

interface CreateStructuredStrategyRequestArgs {
  userId: string;
  strategyName: string;
  category: StrategyCategory;
  instruments: string[];
  feedRequirement: StrategyFeedRequirement | null;
  description: string;
  contactPreference: StrategyContactPreference;
}

export async function createStructuredStrategyRequest(
  args: CreateStructuredStrategyRequestArgs
): Promise<StrategyRequestRow> {
  const result = await pool.query(
    `insert into strategy_requests
       (user_id, idea_text, submission_type, strategy_name, category, instruments, feed_requirement, contact_preference)
     values ($1, $2, 'structured', $3, $4, $5, $6, $7)
     returning id`,
    [
      args.userId,
      args.description,
      args.strategyName,
      args.category,
      args.instruments,
      args.feedRequirement,
      args.contactPreference,
    ]
  );
  const row = await getStrategyRequest(result.rows[0].id);
  if (!row) throw new Error("failed to load created strategy request");

  notifyStrategyRequestSubmitted({
    email: row.userEmail,
    submissionType: row.submissionType,
    summary: row.strategyName ?? row.ideaText,
    adminUrl: "/admin/strategy-requests",
  }).catch(() => {});

  return row;
}

export async function getStrategyRequest(id: string): Promise<StrategyRequestRow | null> {
  const result = await pool.query(
    `select ${SELECT_COLUMNS}
     from strategy_requests sr
     left join users u on u.id = sr.user_id
     where sr.id = $1`,
    [id]
  );
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

export interface ListStrategyRequestsOptions {
  status?: StrategyRequestStatus;
}

export async function listStrategyRequests(
  options: ListStrategyRequestsOptions = {}
): Promise<StrategyRequestRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    params.push(options.status);
    conditions.push(`sr.status = $${params.length}`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await pool.query(
    `select ${SELECT_COLUMNS}
     from strategy_requests sr
     left join users u on u.id = sr.user_id
     ${where}
     order by sr.submitted_at desc`,
    params
  );
  return result.rows.map(mapRow);
}

export async function updateStrategyRequestStatus(id: string, status: StrategyRequestStatus): Promise<void> {
  await pool.query("update strategy_requests set status = $2 where id = $1", [id, status]);
}

export async function updateStrategyRequestNotes(id: string, notes: string | null): Promise<void> {
  await pool.query("update strategy_requests set admin_notes = $2 where id = $1", [id, notes]);
}
