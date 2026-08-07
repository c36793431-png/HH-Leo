import { pool } from "./db";

export const STRATEGY_REQUEST_STATUSES = ["new", "reviewing", "declined", "scoping", "shipped"] as const;
export type StrategyRequestStatus = (typeof STRATEGY_REQUEST_STATUSES)[number];

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
  };
}

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
     returning id, user_id, idea_text, asset_text, timeframe_text, references_text, status, admin_notes, submitted_at`,
    [args.userId, args.ideaText, args.assetText, args.timeframeText, args.referencesText]
  );
  const row = result.rows[0];
  return mapRow({ ...row, user_name: null, user_email: null });
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
    `select sr.id, sr.user_id, u.display_name as user_name, u.email as user_email,
            sr.idea_text, sr.asset_text, sr.timeframe_text, sr.references_text,
            sr.status, sr.admin_notes, sr.submitted_at
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
