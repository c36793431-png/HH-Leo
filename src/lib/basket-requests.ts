import { pool } from "./db";
import { resolveBasketLines, type BasketLine } from "./basket-catalogue";
import { notifyBasketRequestSubmitted } from "./telemetry-sink";

/**
 * The marketplace request basket's storage (0093 basket_requests; coxwell 2026-10-03 23:26Z via
 * marcus m59124, rulings m59146).
 *
 * REQUEST-ONLY. A submit writes one row and sends coxwell one approvals-topic card. It grants
 * nothing and writes no access_requests envelope: the per-feed Request access stays the only
 * tracked approval path. coxwell fulfils by hand with the existing admin tools (Issue licence,
 * Assign feed tier) and then marks the request handled. 'handled' is never an outcome and nothing
 * reads it to grant anything.
 */

export const BASKET_TRIAL_DAYS = 30;

/** Feed-line notes for coxwell (the card and the admin list), stamped at submit from the
 * account's state, in the wording marcus approved (m59142 draft). A note never blocks a send. */
export const BASKET_FEED_NOTE_READY = "ready (licence + server)";
export const BASKET_FEED_NOTE_NOT_READY = "no licence/server yet";

export class TrialNotEligibleError extends Error {
  constructor() {
    super("This account can't start a trial: a trial or licence is already on record");
  }
}
/**
 * May this account choose the basket-level 30-day trial? Only if it has NEVER had any of the
 * five (m59142, ruled m59146):
 *   1. a licences row: user_id = them, or an unclaimed one issued to their email (0001:51-52);
 *   2. an access_requests row decided as a trial (0086:392);
 *   3. a feed_tier_trials row (0036);
 *   4. a black_trials row (0041);
 *   5. an earlier basket_requests row with has_trial (0093), so three baskets sent before
 *      coxwell handles any still carry one trial between them.
 * Revoked and expired rows count: "never had" is the rule.
 */
export async function isBasketTrialEligible(userId: string): Promise<boolean> {
  const result = await pool.query(
    `select not (
        exists (select 1 from licenses l where l.user_id = u.id
                  or (l.user_id is null and u.email is not null and lower(l.claim_email) = lower(u.email)))
        or exists (select 1 from access_requests ar where ar.user_id = u.id and ar.decision = 'trial')
        or exists (select 1 from feed_tier_trials ft where ft.user_id = u.id)
        or exists (select 1 from black_trials bt where bt.user_id = u.id)
        or exists (select 1 from basket_requests br where br.user_id = u.id and br.has_trial)
      ) as eligible
     from users u where u.id = $1`,
    [userId]
  );
  return result.rows[0]?.eligible === true;
}

export interface BasketAccountState {
  trialEligible: boolean;
  /** An active licence with a registered server: a feed line could be switched on today. */
  feedReady: boolean;
  /** Where we confirm: the client-facing steps confirm by email only (coxwell 13:54Z via marcus
   * m59928). Telegram stays on the admin card, read from users at send time. */
  email: string | null;
}

export async function getBasketAccountState(userId: string): Promise<BasketAccountState> {
  const [trialEligible, other] = await Promise.all([
    isBasketTrialEligible(userId),
    pool.query(
      `select email,
         exists (select 1 from server_registrations sr join licenses l on l.id = sr.license_id
                 where l.user_id = users.id and l.status = 'active' and l.expires_at > now()) as feed_ready
       from users where id = $1`,
      [userId]
    ),
  ]);
  const row = other.rows[0] ?? {};
  return {
    trialEligible,
    feedReady: row.feed_ready === true,
    email: row.email ?? null,
  };
}

const PG_UNIQUE_VIOLATION = "23505";

/**
 * Stores one basket request and sends the one approvals-topic card. Everything is re-checked
 * here: lines against the catalogues, the trial against the five sources. The partial unique
 * index on (user_id) where has_trial is the backstop for a double submit that passes the
 * eligibility read twice. basket_requests.telegram_handle is no longer written (the Review step
 * stopped asking, m59928); the column stays for the rows that carry one.
 */
export async function createBasketRequest(args: {
  userId: string;
  lines: unknown;
  wantTrial: boolean;
}): Promise<{ id: string; lines: BasketLine[] }> {
  const lines = resolveBasketLines(args.lines);
  const account = await getBasketAccountState(args.userId);
  if (args.wantTrial && !account.trialEligible) throw new TrialNotEligibleError();
  const stamped = lines.map((l) =>
    l.kind === "feed" ? { ...l, note: account.feedReady ? BASKET_FEED_NOTE_READY : BASKET_FEED_NOTE_NOT_READY } : l
  );

  let id: string;
  try {
    const result = await pool.query(
      `insert into basket_requests (user_id, lines, has_trial)
       values ($1, $2::jsonb, $3) returning id`,
      [args.userId, JSON.stringify(stamped), args.wantTrial]
    );
    id = result.rows[0].id;
  } catch (err) {
    if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) throw new TrialNotEligibleError();
    throw err;
  }

  const user = await pool.query(`select email, telegram_username, telegram_user_id from users where id = $1`, [args.userId]);
  const u = user.rows[0] ?? {};
  await notifyBasketRequestSubmitted({
    reference: basketReference(id),
    email: u.email ?? null,
    telegramUsername: u.telegram_username ?? null,
    telegramUserId: u.telegram_user_id != null ? String(u.telegram_user_id) : null,
    lines: stamped,
    hasTrial: args.wantTrial,
    adminUrl: "https://portal.horizonhft.com/admin/basket-requests",
  }).catch(() => {});

  return { id, lines: stamped };
}

/** The reference the client and coxwell both see: REQ- and the id's first 8 hex digits,
 * upper-cased. Shown, never parsed. */
export function basketReference(id: string): string {
  return `REQ-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export const BASKET_REQUEST_STATUSES = ["new", "handled"] as const;
export type BasketRequestStatus = (typeof BASKET_REQUEST_STATUSES)[number];

export interface BasketRequestRow {
  id: string;
  reference: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  telegram: string | null;
  lines: BasketLine[];
  hasTrial: boolean;
  status: BasketRequestStatus;
  handledAt: Date | null;
  handledByEmail: string | null;
  submittedAt: Date;
}

const SELECT_COLUMNS = `br.id, br.user_id, u.display_name as user_name, u.email as user_email,
       coalesce(u.telegram_username, br.telegram_handle) as telegram, br.lines, br.has_trial,
       br.status, br.handled_at, hb.email as handled_by_email, br.submitted_at`;

function mapRow(row: Record<string, unknown>): BasketRequestRow {
  const id = row.id as string;
  return {
    id,
    reference: basketReference(id),
    userId: row.user_id as string,
    userName: (row.user_name as string | null) ?? null,
    userEmail: (row.user_email as string | null) ?? null,
    telegram: (row.telegram as string | null) ?? null,
    lines: (typeof row.lines === "string" ? JSON.parse(row.lines) : row.lines) as BasketLine[],
    hasTrial: row.has_trial === true,
    status: row.status as BasketRequestStatus,
    handledAt: (row.handled_at as Date | null) ?? null,
    handledByEmail: (row.handled_by_email as string | null) ?? null,
    submittedAt: row.submitted_at as Date,
  };
}

/** Newest first. `userId` = one client's own list (/marketplace/requests); none = the admin list. */
export async function listBasketRequests(options: { status?: BasketRequestStatus; userId?: string } = {}): Promise<BasketRequestRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    params.push(options.status);
    conditions.push(`br.status = $${params.length}`);
  }
  if (options.userId) {
    params.push(options.userId);
    conditions.push(`br.user_id = $${params.length}`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await pool.query(
    `select ${SELECT_COLUMNS}
     from basket_requests br
     left join users u on u.id = br.user_id
     left join users hb on hb.id = br.handled_by
     ${where}
     order by br.submitted_at desc, br.id`,
    params
  );
  return result.rows.map(mapRow);
}

export async function getBasketRequest(id: string): Promise<BasketRequestRow | null> {
  const result = await pool.query(
    `select ${SELECT_COLUMNS}
     from basket_requests br
     left join users u on u.id = br.user_id
     left join users hb on hb.id = br.handled_by
     where br.id = $1`,
    [id]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

/** Admin toggle. Handled stamps who and when; back to new clears both, so the 0093 check
 * (handled <=> handled_at) always holds. Returns the request's user for the admin log, or null
 * when no row changed (unknown id, or already in that state). */
export async function setBasketRequestHandled(id: string, adminUserId: string, handled: boolean): Promise<{ userId: string } | null> {
  const result = handled
    ? await pool.query(
        `update basket_requests set status = 'handled', handled_at = now(), handled_by = $2
         where id = $1 and status = 'new' returning user_id`,
        [id, adminUserId]
      )
    : await pool.query(
        `update basket_requests set status = 'new', handled_at = null, handled_by = null
         where id = $1 and status = 'handled' returning user_id`,
        [id]
      );
  return result.rows[0] ? { userId: result.rows[0].user_id as string } : null;
}
