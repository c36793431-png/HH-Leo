import { pool } from "./db";
import { notifyStrategySubmissionSubmitted } from "./telemetry-sink";

export const STRATEGY_CATEGORIES = ["arbitrage", "momentum", "grid", "scalping", "custom"] as const;
export type StrategyCategory = (typeof STRATEGY_CATEGORIES)[number];

export const STRATEGY_INSTRUMENTS = ["FX majors", "Gold", "Indices", "Futures", "Crypto"] as const;
export type StrategyInstrument = (typeof STRATEGY_INSTRUMENTS)[number];

export const STRATEGY_FEED_REQUIREMENTS = ["london", "ny", "cme", "tokyo"] as const;
export type StrategyFeedRequirement = (typeof STRATEGY_FEED_REQUIREMENTS)[number];

export const STRATEGY_CONTACT_PREFERENCES = ["portal", "telegram", "email"] as const;
export type StrategyContactPreference = (typeof STRATEGY_CONTACT_PREFERENCES)[number];

export const STRATEGY_SUBMISSION_STATUSES = [
  "pending",
  "under_review",
  "approved_draft",
  "listed",
  "declined",
  "withdrawn",
] as const;
export type StrategySubmissionStatus = (typeof STRATEGY_SUBMISSION_STATUSES)[number];

export interface StrategySubmissionRow {
  id: string;
  authorUserId: string;
  authorName: string | null;
  authorEmail: string | null;
  name: string;
  category: StrategyCategory;
  instruments: string[];
  feedRegion: StrategyFeedRequirement | null;
  description: string;
  contactPreference: StrategyContactPreference;
  status: StrategySubmissionStatus;
  adminNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapRow(row: {
  id: string;
  author_user_id: string;
  author_name: string | null;
  author_email: string | null;
  name: string;
  category: string;
  instruments: string[];
  feed_region: string | null;
  description: string;
  contact_preference: string;
  status: string;
  admin_notes: string | null;
  created_at: Date;
  updated_at: Date;
}): StrategySubmissionRow {
  return {
    id: row.id,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    authorEmail: row.author_email,
    name: row.name,
    category: row.category as StrategyCategory,
    instruments: row.instruments,
    feedRegion: row.feed_region as StrategyFeedRequirement | null,
    description: row.description,
    contactPreference: row.contact_preference as StrategyContactPreference,
    status: row.status as StrategySubmissionStatus,
    adminNotes: row.admin_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `ss.id, ss.author_user_id, u.display_name as author_name, u.email as author_email,
       ss.name, ss.category, ss.instruments, ss.feed_region, ss.description, ss.contact_preference,
       ss.status, ss.admin_notes, ss.created_at, ss.updated_at`;

interface CreateStrategySubmissionArgs {
  authorUserId: string;
  name: string;
  category: StrategyCategory;
  instruments: string[];
  feedRegion: StrategyFeedRequirement | null;
  description: string;
  contactPreference: StrategyContactPreference;
}

export async function createStrategySubmission(
  args: CreateStrategySubmissionArgs
): Promise<StrategySubmissionRow> {
  const result = await pool.query(
    `insert into strategy_submissions
       (author_user_id, name, category, instruments, feed_region, description, contact_preference)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      args.authorUserId,
      args.name,
      args.category,
      args.instruments,
      args.feedRegion,
      args.description,
      args.contactPreference,
    ]
  );
  const row = await getStrategySubmission(result.rows[0].id);
  if (!row) throw new Error("failed to load created strategy submission");

  notifyStrategySubmissionSubmitted({
    email: row.authorEmail,
    summary: row.name,
    adminUrl: "https://portal.horizonhft.com/admin/strategy-submissions",
  }).catch(() => {});

  return row;
}

export async function getStrategySubmission(id: string): Promise<StrategySubmissionRow | null> {
  const result = await pool.query(
    `select ${SELECT_COLUMNS}
     from strategy_submissions ss
     left join users u on u.id = ss.author_user_id
     where ss.id = $1`,
    [id]
  );
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

export interface ListStrategySubmissionsOptions {
  status?: StrategySubmissionStatus;
}

export async function listStrategySubmissions(
  options: ListStrategySubmissionsOptions = {}
): Promise<StrategySubmissionRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    params.push(options.status);
    conditions.push(`ss.status = $${params.length}`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await pool.query(
    `select ${SELECT_COLUMNS}
     from strategy_submissions ss
     left join users u on u.id = ss.author_user_id
     ${where}
     order by ss.created_at desc`,
    params
  );
  return result.rows.map(mapRow);
}

export async function updateStrategySubmissionStatus(id: string, status: StrategySubmissionStatus): Promise<void> {
  await pool.query("update strategy_submissions set status = $2, updated_at = now() where id = $1", [id, status]);
}

export async function updateStrategySubmissionNotes(id: string, notes: string | null): Promise<void> {
  await pool.query("update strategy_submissions set admin_notes = $2, updated_at = now() where id = $1", [
    id,
    notes,
  ]);
}
