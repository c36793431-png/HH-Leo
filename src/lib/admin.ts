import { pool } from "./db";
import { ADMIN_USERS_PANEL_EMAIL } from "./admin-users-panel";

/**
 * All admin_actions callers gate on isAdminUser() first. session.user.id (JWT sub)
 * can nonetheless point at a users row that no longer exists (stale session, or a
 * row that was recreated under a new id) — inserts against any users.id FK (admin_actions,
 * downloads.uploaded_by, etc) would then 500. Resolve to a real users.id, falling back to
 * the original hardcoded admin's row (source of truth for that account) over the possibly-
 * stale session id, backfilling only if neither exists. Shared by logAdminAction and any
 * admin write path that stamps a users.id.
 */
export async function resolveAdminUserId(sessionUserId: string): Promise<string> {
  const byId = await pool.query("select id from users where id = $1", [sessionUserId]);
  if (byId.rowCount) return sessionUserId;

  const byEmail = await pool.query("select id from users where email = $1", [
    ADMIN_USERS_PANEL_EMAIL,
  ]);
  if (byEmail.rowCount) return byEmail.rows[0].id;

  const inserted = await pool.query(
    `insert into users (id, email, display_name, role)
     values ($1, $2, $2, 'admin')
     returning id`,
    [sessionUserId, ADMIN_USERS_PANEL_EMAIL]
  );
  return inserted.rows[0].id;
}

/**
 * Machine-triggered write paths (CI publish, cron) have no session user to resolve.
 * Attributes the admin_actions row to the same admin account resolveAdminUserId()
 * falls back to for a stale session, creating it if this is the very first write.
 */
export async function resolveServiceAccountUserId(): Promise<string> {
  const byEmail = await pool.query("select id from users where email = $1", [
    ADMIN_USERS_PANEL_EMAIL,
  ]);
  if (byEmail.rowCount) return byEmail.rows[0].id;

  const inserted = await pool.query(
    `insert into users (id, email, display_name, role)
     values (gen_random_uuid(), $1, $1, 'admin')
     returning id`,
    [ADMIN_USERS_PANEL_EMAIL]
  );
  return inserted.rows[0].id;
}

export async function logAdminAction(
  adminUserId: string,
  actionType: string,
  targetUserId?: string | null,
  details?: unknown,
  targetLicenseId?: string | null
): Promise<void> {
  const resolvedAdminUserId = await resolveAdminUserId(adminUserId);
  await pool.query(
    `insert into admin_actions (admin_user_id, action_type, target_user_id, target_license_id, details_json)
     values ($1, $2, $3, $4, $5)`,
    [
      resolvedAdminUserId,
      actionType,
      targetUserId ?? null,
      targetLicenseId ?? null,
      details ? JSON.stringify(details) : null,
    ]
  );
}

export interface AdminActionRow {
  id: string;
  actorUserId: string;
  actorEmail: string | null;
  action: string;
  targetUserId: string | null;
  targetUserEmail: string | null;
  targetLicenseId: string | null;
  targetLicenseKey: string | null;
  details: unknown;
  createdAt: Date;
}

export interface ListAdminActionsFilters {
  actorUserId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  page?: number;
  perPage?: number;
}

/** /admin/history source of truth: every admin_actions row, newest first, joined to human-readable actor/target labels. */
export async function listAdminActions(
  filters: ListAdminActionsFilters = {}
): Promise<{ rows: AdminActionRow[]; total: number }> {
  const perPage = filters.perPage ?? 50;
  const page = Math.max(1, filters.page ?? 1);
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.actorUserId) {
    params.push(filters.actorUserId);
    conditions.push(`a.admin_user_id = $${params.length}`);
  }
  if (filters.action) {
    params.push(filters.action);
    conditions.push(`a.action_type = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    conditions.push(`a.created_at >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    conditions.push(`a.created_at <= $${params.length}`);
  }

  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";

  const countResult = await pool.query<{ count: string }>(
    `select count(*) from admin_actions a ${where}`,
    params
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  params.push(perPage);
  params.push(offset);
  const result = await pool.query(
    `select a.id, a.admin_user_id, au.email as actor_email, a.action_type,
            a.target_user_id, tu.email as target_user_email,
            a.target_license_id, tl.license_key as target_license_key,
            a.details_json, a.created_at
     from admin_actions a
     left join users au on au.id = a.admin_user_id
     left join users tu on tu.id = a.target_user_id
     left join licenses tl on tl.id = a.target_license_id
     ${where}
     order by a.created_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params
  );

  return {
    total,
    rows: result.rows.map((r) => ({
      id: r.id,
      actorUserId: r.admin_user_id,
      actorEmail: r.actor_email,
      action: r.action_type,
      targetUserId: r.target_user_id,
      targetUserEmail: r.target_user_email,
      targetLicenseId: r.target_license_id,
      targetLicenseKey: r.target_license_key,
      details: r.details_json,
      createdAt: r.created_at,
    })),
  };
}

export interface AdminActorOption {
  userId: string;
  email: string | null;
}

/** Distinct actors who've ever taken an admin action — powers the /admin/history actor filter. */
export async function listAdminActionActors(): Promise<AdminActorOption[]> {
  const result = await pool.query(`
    select distinct a.admin_user_id as user_id, u.email
    from admin_actions a
    left join users u on u.id = a.admin_user_id
    order by u.email
  `);
  return result.rows.map((r) => ({ userId: r.user_id, email: r.email }));
}

export async function listAdminActionTypes(): Promise<string[]> {
  const result = await pool.query(`
    select distinct action_type from admin_actions order by action_type
  `);
  return result.rows.map((r) => r.action_type);
}
