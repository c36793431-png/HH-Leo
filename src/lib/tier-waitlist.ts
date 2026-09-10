import { pool } from "./db";

export interface TierWaitlistRow {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  region: string;
  tierKey: string;
  createdAt: Date;
}

interface Row {
  id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  region: string;
  tier_key: string;
  created_at: Date;
}

function mapRow(row: Row): TierWaitlistRow {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    region: row.region,
    tierKey: row.tier_key,
    createdAt: row.created_at,
  };
}

const SELECT_BASE = `
  select w.id, w.user_id, u.display_name as user_name, u.email as user_email,
         w.region, w.tier_key, w.created_at
  from tier_waitlist w
  join users u on u.id = w.user_id
`;

export async function listTierWaitlist(): Promise<TierWaitlistRow[]> {
  const result = await pool.query<Row>(`${SELECT_BASE} order by w.created_at desc`);
  return result.rows.map(mapRow);
}
