import { pool } from "./db";

export const FEED_REQUEST_STATUSES = ["new", "reviewing", "declined", "shipped"] as const;
export type FeedRequestStatus = (typeof FEED_REQUEST_STATUSES)[number];

export interface FeedRequestRow {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  venueText: string;
  useCaseText: string;
  preferredLocation: string | null;
  status: FeedRequestStatus;
  adminNotes: string | null;
  submittedAt: Date;
}

function mapRow(row: {
  id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  venue_text: string;
  use_case_text: string;
  preferred_location: string | null;
  status: string;
  admin_notes: string | null;
  submitted_at: Date;
}): FeedRequestRow {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    venueText: row.venue_text,
    useCaseText: row.use_case_text,
    preferredLocation: row.preferred_location,
    status: row.status as FeedRequestStatus,
    adminNotes: row.admin_notes,
    submittedAt: row.submitted_at,
  };
}

interface CreateFeedRequestArgs {
  userId: string;
  venueText: string;
  useCaseText: string;
  preferredLocation: string | null;
}

export async function createFeedRequest(args: CreateFeedRequestArgs): Promise<FeedRequestRow> {
  const result = await pool.query(
    `insert into feed_requests (user_id, venue_text, use_case_text, preferred_location)
     values ($1, $2, $3, $4)
     returning id, user_id, venue_text, use_case_text, preferred_location, status, admin_notes, submitted_at`,
    [args.userId, args.venueText, args.useCaseText, args.preferredLocation]
  );
  const row = result.rows[0];
  return mapRow({ ...row, user_name: null, user_email: null });
}

export interface ListFeedRequestsOptions {
  status?: FeedRequestStatus;
}

export async function listFeedRequests(options: ListFeedRequestsOptions = {}): Promise<FeedRequestRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    params.push(options.status);
    conditions.push(`fr.status = $${params.length}`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await pool.query(
    `select fr.id, fr.user_id, u.display_name as user_name, u.email as user_email,
            fr.venue_text, fr.use_case_text, fr.preferred_location, fr.status, fr.admin_notes, fr.submitted_at
     from feed_requests fr
     left join users u on u.id = fr.user_id
     ${where}
     order by fr.submitted_at desc`,
    params
  );
  return result.rows.map(mapRow);
}

export async function updateFeedRequestStatus(id: string, status: FeedRequestStatus): Promise<void> {
  await pool.query("update feed_requests set status = $2 where id = $1", [id, status]);
}

export async function updateFeedRequestNotes(id: string, notes: string | null): Promise<void> {
  await pool.query("update feed_requests set admin_notes = $2 where id = $1", [id, notes]);
}
