import { pool } from "./db";
import { notifyBlackWaitlistJoined } from "./telemetry-sink";

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

export async function hasJoinedTierWaitlist(userId: string, region: string, tierKey: string): Promise<boolean> {
  const result = await pool.query(
    `select 1 from tier_waitlist where user_id = $1 and region = $2 and tier_key = $3`,
    [userId, region, tierKey]
  );
  return (result.rowCount ?? 0) > 0;
}

interface JoinArgs {
  userId: string;
  region: string;
  tierKey: string;
  tierName: string;
}

export async function joinTierWaitlist(args: JoinArgs): Promise<TierWaitlistRow> {
  const result = await pool.query<{ id: string; inserted: boolean }>(
    `insert into tier_waitlist (user_id, region, tier_key) values ($1, $2, $3)
     on conflict (user_id, region, tier_key) do update set region = excluded.region
     returning id, (xmax = 0) as inserted`,
    [args.userId, args.region, args.tierKey]
  );
  const inserted = result.rows[0].inserted;
  const row = await getTierWaitlistEntry(result.rows[0].id);
  if (!row) throw new Error("failed to load waitlist entry");

  if (inserted) {
    await notifyBlackWaitlistJoined({
      name: row.userName,
      email: row.userEmail,
      tierName: args.tierName,
    }).catch(() => {});
  }
  return row;
}

export async function getTierWaitlistEntry(id: string): Promise<TierWaitlistRow | null> {
  const result = await pool.query<Row>(`${SELECT_BASE} where w.id = $1`, [id]);
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

export async function listTierWaitlist(): Promise<TierWaitlistRow[]> {
  const result = await pool.query<Row>(`${SELECT_BASE} order by w.created_at desc`);
  return result.rows.map(mapRow);
}
