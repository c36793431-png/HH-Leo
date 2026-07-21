import { pool } from "./db";

export async function logAdminAction(
  adminUserId: string,
  actionType: string,
  targetUserId?: string | null,
  details?: unknown
): Promise<void> {
  await pool.query(
    `insert into admin_actions (admin_user_id, action_type, target_user_id, details_json)
     values ($1, $2, $3, $4)`,
    [adminUserId, actionType, targetUserId ?? null, details ? JSON.stringify(details) : null]
  );
}
