/** Client connection details per feed tier (B3-2: coxwell via marcus m64680; plan m64756-9; rulings m64767 +
 * m64808; Fable design pass m64804 S1 + N1-N2). An admin edits one row per (tier, connection type) on
 * /admin/feed-connections and a per-client username per connection type on /admin/users/[id]. No password is stored
 * or rendered anywhere here: a shared FIX password is sent to the client separately. Every write and its
 * admin_actions row commit in one transaction, so neither exists without the other (Fable N2). */
import { pool } from "./db";
import { resolveAdminUserId } from "./admin";

export const CONN_TYPES = ["ctrader_fix", "b_fix", "horizon_direct"] as const;
export type ConnType = (typeof CONN_TYPES)[number];
export const CONN_TYPE_LABELS: Record<ConnType, string> = {
  ctrader_fix: "cTrader FIX",
  b_fix: "B FIX",
  horizon_direct: "Horizon Direct",
};

/** Fable N1: the DB checks array + length; the element shape is checked here, before any write. */
export const MAX_SYMBOLS = 64;
const SYMBOL = /^[A-Z0-9._]{1,16}$/;
const DESCRIPTION_MAX = 80;
const HOST = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;
export const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,31}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_TYPE_MAX = 120;
const SESSION_HOURS_MAX = 200;

export interface SymbolEntry {
  symbol: string;
  description: string;
}

const isConnType = (v: string): v is ConnType => (CONN_TYPES as readonly string[]).includes(v);

/** One symbol per line, as an admin pastes it: "GC.FUT Gold" or "GC.FUT — Gold" (also "-" or "–"). Blank lines are
 * skipped. A malformed, duplicate or over-long line throws, naming the line; so do more than 64 symbols. */
export function parseSymbolLines(text: string): SymbolEntry[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > MAX_SYMBOLS) throw new Error(`At most ${MAX_SYMBOLS} symbols (got ${lines.length})`);
  const seen = new Set<string>();
  return lines.map((line, i) => {
    const m = /^(\S+)\s+(?:[—–-]\s+)?(.+)$/.exec(line);
    if (!m || !SYMBOL.test(m[1])) throw new Error(`Symbol line ${i + 1}: expected "SYMBOL Description" with SYMBOL in A-Z 0-9 . _ (max 16)`);
    const description = m[2].trim();
    if (description.length > DESCRIPTION_MAX) throw new Error(`Symbol line ${i + 1}: description over ${DESCRIPTION_MAX} characters`);
    if (seen.has(m[1])) throw new Error(`Symbol line ${i + 1}: ${m[1]} is listed twice`);
    seen.add(m[1]);
    return { symbol: m[1], description };
  });
}

export interface ConnectionInput {
  feedTierId: string;
  connType: string;
  host: string;
  port: string;
  dataType: string;
  sessionHours: string;
  symbols: string;
}

interface ConnectionValues {
  host: string;
  port: number;
  dataType: string | null;
  sessionHours: string | null;
  symbols: SymbolEntry[];
}

function validateConnection(input: ConnectionInput): ConnectionValues & { feedTierId: string; connType: ConnType } {
  if (!UUID.test(input.feedTierId)) throw new Error("No tier");
  if (!isConnType(input.connType)) throw new Error("Unknown connection type");
  const host = input.host.trim();
  if (!HOST.test(host)) throw new Error("Host: a hostname or IP, no spaces");
  const portText = input.port.trim();
  const port = /^\d{1,5}$/.test(portText) ? Number(portText) : NaN;
  if (!(port >= 1 && port <= 65535)) throw new Error("Port: a whole number from 1 to 65535");
  const dataType = input.dataType.trim() || null;
  if (dataType && dataType.length > DATA_TYPE_MAX) throw new Error(`Data type: at most ${DATA_TYPE_MAX} characters`);
  const sessionHours = input.sessionHours.trim() || null;
  if (sessionHours && sessionHours.length > SESSION_HOURS_MAX) throw new Error(`Session hours: at most ${SESSION_HOURS_MAX} characters`);
  return { feedTierId: input.feedTierId, connType: input.connType, host, port, dataType, sessionHours, symbols: parseSymbolLines(input.symbols) };
}

/** Create or replace one tier's row for one connection type. The audit row carries the tier key, the type and the
 * row before and after (Fable N2); it has no target user. */
export async function setFeedTierConnection(input: ConnectionInput, adminUserIdRaw: string): Promise<void> {
  const v = validateConnection(input);
  const adminUserId = await resolveAdminUserId(adminUserIdRaw);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const tier = (await client.query(`select tier_key from feed_tiers where id = $1`, [v.feedTierId])).rows[0] as { tier_key: string } | undefined;
    if (!tier) throw new Error("Tier not found");
    const prev = (
      await client.query(
        `select host, port, data_type, session_hours, symbols from feed_tier_connections where feed_tier_id = $1 and conn_type = $2 for update`,
        [v.feedTierId, v.connType]
      )
    ).rows[0] as { host: string; port: number; data_type: string | null; session_hours: string | null; symbols: SymbolEntry[] } | undefined;
    await client.query(
      `insert into feed_tier_connections (feed_tier_id, conn_type, host, port, data_type, session_hours, symbols, updated_at, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, now(), $8)
       on conflict (feed_tier_id, conn_type) do update set host = excluded.host, port = excluded.port, data_type = excluded.data_type,
         session_hours = excluded.session_hours, symbols = excluded.symbols, updated_at = now(), updated_by = excluded.updated_by`,
      [v.feedTierId, v.connType, v.host, v.port, v.dataType, v.sessionHours, JSON.stringify(v.symbols), adminUserId]
    );
    const before: ConnectionValues | null = prev
      ? { host: prev.host, port: prev.port, dataType: prev.data_type, sessionHours: prev.session_hours, symbols: prev.symbols }
      : null;
    const after: ConnectionValues = { host: v.host, port: v.port, dataType: v.dataType, sessionHours: v.sessionHours, symbols: v.symbols };
    await client.query(`insert into admin_actions (admin_user_id, action_type, details_json) values ($1, 'feed_tier_connection_set', $2)`, [
      adminUserId,
      JSON.stringify({ tier_key: tier.tier_key, conn_type: v.connType, before, after }),
    ]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export interface FeedTierConnection extends ConnectionValues {
  feedTierId: string;
  tierKey: string;
  tierName: string;
  connType: ConnType;
  label: string;
  updatedAt: Date;
}

export async function listFeedTierConnections(): Promise<FeedTierConnection[]> {
  const r = await pool.query(
    `select c.feed_tier_id, ft.tier_key, ft.name as tier_name, c.conn_type, c.host, c.port, c.data_type, c.session_hours, c.symbols, c.updated_at
       from feed_tier_connections c join feed_tiers ft on ft.id = c.feed_tier_id
      order by ft.tier_key, c.conn_type`
  );
  return (r.rows as Record<string, unknown>[]).map((row) => ({
    feedTierId: row.feed_tier_id as string,
    tierKey: row.tier_key as string,
    tierName: row.tier_name as string,
    connType: row.conn_type as ConnType,
    label: CONN_TYPE_LABELS[row.conn_type as ConnType],
    host: row.host as string,
    port: row.port as number,
    dataType: row.data_type as string | null,
    sessionHours: row.session_hours as string | null,
    symbols: row.symbols as SymbolEntry[],
    updatedAt: new Date(row.updated_at as string),
  }));
}

export interface ClientLoginInput {
  userId: string;
  feedTierId: string;
  connType: string;
  username: string;
}

/** Set, change or clear (empty name) one client's username for one connection type of a tier. The connection row
 * must exist (composite FK). A name another client holds on the same (tier, type) is refused in words. The audit row
 * targets the client and carries the tier key, the type and the name before and after (Fable N2). */
export async function setClientLogin(input: ClientLoginInput, adminUserIdRaw: string): Promise<void> {
  if (!UUID.test(input.userId)) throw new Error("No client");
  if (!UUID.test(input.feedTierId)) throw new Error("No tier");
  if (!isConnType(input.connType)) throw new Error("Unknown connection type");
  const connType = input.connType;
  const username = input.username.trim() || null;
  if (username && !USERNAME.test(username)) throw new Error("Username: 2-32 of A-Z a-z 0-9 _ . -, starting with a letter or digit");
  const adminUserId = await resolveAdminUserId(adminUserIdRaw);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const conn = (
      await client.query(`select ft.tier_key from feed_tier_connections c join feed_tiers ft on ft.id = c.feed_tier_id where c.feed_tier_id = $1 and c.conn_type = $2`, [
        input.feedTierId,
        connType,
      ])
    ).rows[0] as { tier_key: string } | undefined;
    if (!conn) throw new Error(`That tier has no ${CONN_TYPE_LABELS[connType]} connection set`);
    const prev = (
      await client.query(`select username from feed_client_logins where subscriber_user_id = $1 and feed_tier_id = $2 and conn_type = $3 for update`, [
        input.userId,
        input.feedTierId,
        connType,
      ])
    ).rows[0] as { username: string } | undefined;
    const before = prev?.username ?? null;
    if (before === username) {
      await client.query("commit");
      return;
    }
    if (username) {
      const taken = (
        await client.query(`select 1 from feed_client_logins where feed_tier_id = $1 and conn_type = $2 and username = $3 and subscriber_user_id <> $4`, [
          input.feedTierId,
          connType,
          username,
          input.userId,
        ])
      ).rows.length;
      if (taken) throw new Error(`${username} is already used by another client on ${conn.tier_key} ${CONN_TYPE_LABELS[connType]}`);
      await client.query(
        `insert into feed_client_logins (subscriber_user_id, feed_tier_id, conn_type, username, updated_at, updated_by)
         values ($1, $2, $3, $4, now(), $5)
         on conflict (subscriber_user_id, feed_tier_id, conn_type) do update set username = excluded.username, updated_at = now(), updated_by = excluded.updated_by`,
        [input.userId, input.feedTierId, connType, username, adminUserId]
      );
    } else {
      await client.query(`delete from feed_client_logins where subscriber_user_id = $1 and feed_tier_id = $2 and conn_type = $3`, [
        input.userId,
        input.feedTierId,
        connType,
      ]);
    }
    await client.query(`insert into admin_actions (admin_user_id, action_type, target_user_id, details_json) values ($1, 'feed_client_login_set', $2, $3)`, [
      adminUserId,
      input.userId,
      JSON.stringify({ tier_key: conn.tier_key, conn_type: connType, before, after: username }),
    ]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    // Two admins racing the same name past the check above: the unique key still holds, in the same words.
    if ((err as { code?: string }).code === "23505") throw new Error(`${username} is already used by another client on that connection`);
    throw err;
  } finally {
    client.release();
  }
}

export interface ClientLoginRow {
  feedTierId: string;
  tierKey: string;
  tierName: string;
  connType: ConnType;
  label: string;
  username: string | null;
}

/** For /admin/users/[id]: one row per connection type of every tier the client has a subscription row on, in any
 * status, so a name can be set before approval or kept across a lapse. A tier with no connection rows lists nothing. */
export async function listClientLoginRows(userId: string): Promise<ClientLoginRow[]> {
  const r = await pool.query(
    `select c.feed_tier_id, ft.tier_key, ft.name as tier_name, c.conn_type, l.username
       from feed_tier_connections c
       join feed_tiers ft on ft.id = c.feed_tier_id
       left join feed_client_logins l on l.subscriber_user_id = $1 and l.feed_tier_id = c.feed_tier_id and l.conn_type = c.conn_type
      where c.feed_tier_id in (select feed_tier_id from feed_subscriptions where subscriber_user_id = $1)
      order by ft.tier_key, c.conn_type`,
    [userId]
  );
  return (r.rows as Record<string, unknown>[]).map((row) => ({
    feedTierId: row.feed_tier_id as string,
    tierKey: row.tier_key as string,
    tierName: row.tier_name as string,
    connType: row.conn_type as ConnType,
    label: CONN_TYPE_LABELS[row.conn_type as ConnType],
    username: (row.username as string | null) ?? null,
  }));
}
