import { pool } from "./db";

export const CONFIG_SUMMARY_STRATEGIES = ["1 Leg", "2 Leg Lock", "Trend Impulse", "OBI", "Grid"] as const;
export type ConfigSummaryStrategy = (typeof CONFIG_SUMMARY_STRATEGIES)[number];

export type ConfigSummarySource = "self_reported" | "admin_verified";

export interface ConfigSummary {
  userId: string;
  broker: string | null;
  accountType: string | null;
  commissionPtsRoundTrip: number | null;
  fastFeedProvider: string | null;
  symbols: string[];
  strategy: ConfigSummaryStrategy | null;
  configJson: Record<string, unknown>;
  notes: string | null;
  source: ConfigSummarySource;
  updatedBy: string | null;
  updatedByEmail: string | null;
  updatedAt: Date;
}

export interface ConfigSummaryInput {
  broker: string | null;
  accountType: string | null;
  commissionPtsRoundTrip: number | null;
  fastFeedProvider: string | null;
  symbols: string[];
  strategy: ConfigSummaryStrategy | null;
  configJson: Record<string, unknown>;
  notes: string | null;
}

interface ConfigSummaryRow {
  user_id: string;
  broker: string | null;
  account_type: string | null;
  commission_pts_round_trip: number | null;
  fast_feed_provider: string | null;
  symbols: string[];
  strategy: string | null;
  config_json: Record<string, unknown>;
  notes: string | null;
  source: ConfigSummarySource;
  updated_by: string | null;
  updated_by_email: string | null;
  updated_at: Date;
}

function mapRow(row: ConfigSummaryRow): ConfigSummary {
  return {
    userId: row.user_id,
    broker: row.broker,
    accountType: row.account_type,
    commissionPtsRoundTrip: row.commission_pts_round_trip,
    fastFeedProvider: row.fast_feed_provider,
    symbols: row.symbols ?? [],
    strategy: (row.strategy as ConfigSummaryStrategy | null) ?? null,
    configJson: row.config_json ?? {},
    notes: row.notes,
    source: row.source,
    updatedBy: row.updated_by,
    updatedByEmail: row.updated_by_email,
    updatedAt: row.updated_at,
  };
}

export async function getConfigSummary(userId: string): Promise<ConfigSummary | null> {
  const result = await pool.query<ConfigSummaryRow>(
    `select s.*, u.email as updated_by_email
     from user_config_summaries s
     left join users u on u.id = s.updated_by
     where s.user_id = $1`,
    [userId]
  );
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

/** Upserts the current row and appends a copy to the history table in one transaction, so the
 * timeline table can never drift from what's actually live — every save is one write, not two
 * independent ones a caller could half-apply. */
export async function saveConfigSummary(
  userId: string,
  input: ConfigSummaryInput,
  source: ConfigSummarySource,
  updatedBy: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into user_config_summaries
         (user_id, broker, account_type, commission_pts_round_trip, fast_feed_provider, symbols, strategy, config_json, notes, source, updated_by, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       on conflict (user_id) do update set
         broker = excluded.broker,
         account_type = excluded.account_type,
         commission_pts_round_trip = excluded.commission_pts_round_trip,
         fast_feed_provider = excluded.fast_feed_provider,
         symbols = excluded.symbols,
         strategy = excluded.strategy,
         config_json = excluded.config_json,
         notes = excluded.notes,
         source = excluded.source,
         updated_by = excluded.updated_by,
         updated_at = now()`,
      [
        userId,
        input.broker,
        input.accountType,
        input.commissionPtsRoundTrip,
        input.fastFeedProvider,
        input.symbols,
        input.strategy,
        JSON.stringify(input.configJson),
        input.notes,
        source,
        updatedBy,
      ]
    );
    await client.query(
      `insert into user_config_summary_history
         (user_id, broker, account_type, commission_pts_round_trip, fast_feed_provider, symbols, strategy, config_json, notes, source, updated_by, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
      [
        userId,
        input.broker,
        input.accountType,
        input.commissionPtsRoundTrip,
        input.fastFeedProvider,
        input.symbols,
        input.strategy,
        JSON.stringify(input.configJson),
        input.notes,
        source,
        updatedBy,
      ]
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteConfigSummary(userId: string): Promise<void> {
  await pool.query("delete from user_config_summaries where user_id = $1", [userId]);
}

/** config_json is edited as a flat "Gap=35 / SL=30 / TP=100" line rather than raw JSON —
 * the field set varies by strategy and traders paste this shorthand from their own notes. */
export function parseConfigParamsText(text: string): Record<string, unknown> {
  const configJson: Record<string, unknown> = {};
  for (const part of text.split("/")) {
    const kv = part.trim().split("=");
    if (kv.length === 2 && kv[0].trim()) {
      const k = kv[0].trim();
      const v = kv[1].trim();
      const n = Number(v);
      configJson[k] = Number.isFinite(n) && v !== "" ? n : v;
    }
  }
  return configJson;
}

export function stringifyConfigParams(configJson: Record<string, unknown>): string {
  return Object.entries(configJson)
    .map(([k, v]) => `${k}=${v}`)
    .join(" / ");
}

/** Parses the "Broker: PUPrime (ECN)" quick-entry block from the admin paste-config box.
 * Best-effort — unrecognized lines are ignored, and everything after "Config:" is split on
 * " / " into key=value pairs for config_json rather than a fixed field list, since the
 * per-strategy params (Gap/SL/TP/TrailStart/...) vary by strategy. */
export function parseConfigSummaryPaste(text: string): Partial<ConfigSummaryInput> {
  const result: Partial<ConfigSummaryInput> = {};
  const lines = text.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(/^([A-Za-z ]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (!value) continue;

    if (key === "broker") {
      const brokerMatch = value.match(/^(.*?)\s*\((.*)\)\s*$/);
      if (brokerMatch) {
        result.broker = brokerMatch[1].trim();
        result.accountType = brokerMatch[2].trim();
      } else {
        result.broker = value;
      }
    } else if (key === "commission") {
      const num = value.match(/-?\d+(\.\d+)?/);
      if (num) result.commissionPtsRoundTrip = Math.round(parseFloat(num[0]));
    } else if (key === "feed") {
      result.fastFeedProvider = value;
    } else if (key === "symbol" || key === "symbols") {
      result.symbols = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (key === "strategy") {
      const found = CONFIG_SUMMARY_STRATEGIES.find((s) => s.toLowerCase() === value.toLowerCase());
      if (found) result.strategy = found;
    } else if (key === "config") {
      result.configJson = parseConfigParamsText(value);
    } else if (key === "notes") {
      result.notes = value;
    }
  }
  return result;
}
