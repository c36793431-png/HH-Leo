import { pool } from "./db";

export type StrategyKey = "1leg" | "2leg_lock" | "trend_impulse" | "obi" | "grid";
export type SetfileSource = "verified" | "example";

export interface SetfileRow {
  id: string;
  sortOrder: number;
  strategyKey: StrategyKey;
  source: SetfileSource;
  name: string;
  subtitle: string;
  explanation: string;
  params: string;
  sessionWindow: string | null;
  warnings: string | null;
  active: boolean;
  updatedAt: Date;
}

function mapRow(row: Record<string, unknown>): SetfileRow {
  return {
    id: row.id as string,
    sortOrder: Number(row.sort_order),
    strategyKey: row.strategy_key as StrategyKey,
    source: row.source as SetfileSource,
    name: row.name as string,
    subtitle: row.subtitle as string,
    explanation: row.explanation as string,
    params: row.params as string,
    sessionWindow: (row.session_window as string | null) ?? null,
    warnings: (row.warnings as string | null) ?? null,
    active: row.active as boolean,
    updatedAt: row.updated_at as Date,
  };
}

const SELECT_COLUMNS =
  "id, sort_order, strategy_key, source, name, subtitle, explanation, params, session_window, warnings, active, updated_at";

/** Portal-facing: only active rows, ordered for grouped rendering. */
export async function listActiveSetfiles(): Promise<SetfileRow[]> {
  const result = await pool.query(
    `select ${SELECT_COLUMNS} from strategy_setfiles where active = true order by strategy_key, sort_order`
  );
  return result.rows.map(mapRow);
}

/** Admin-facing: every row (active + disabled) in display order. */
export async function listAllSetfiles(): Promise<SetfileRow[]> {
  const result = await pool.query(`select ${SELECT_COLUMNS} from strategy_setfiles order by sort_order`);
  return result.rows.map(mapRow);
}

interface SetfileInput {
  strategyKey: StrategyKey;
  source: SetfileSource;
  name: string;
  subtitle: string;
  explanation: string;
  params: string;
  sessionWindow?: string | null;
  warnings?: string | null;
}

export async function createSetfile(input: SetfileInput, updatedBy: string): Promise<SetfileRow> {
  const maxOrder = await pool.query<{ max: number | null }>(
    "select max(sort_order) as max from strategy_setfiles"
  );
  const sortOrder = (maxOrder.rows[0]?.max ?? 0) + 1;
  const result = await pool.query(
    `insert into strategy_setfiles
       (sort_order, strategy_key, source, name, subtitle, explanation, params, session_window, warnings, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning ${SELECT_COLUMNS}`,
    [
      sortOrder,
      input.strategyKey,
      input.source,
      input.name,
      input.subtitle,
      input.explanation,
      input.params,
      input.sessionWindow ?? null,
      input.warnings ?? null,
      updatedBy,
    ]
  );
  return mapRow(result.rows[0]);
}

export async function updateSetfile(id: string, input: SetfileInput, updatedBy: string): Promise<SetfileRow> {
  const result = await pool.query(
    `update strategy_setfiles
     set strategy_key = $2, source = $3, name = $4, subtitle = $5, explanation = $6,
         params = $7, session_window = $8, warnings = $9, updated_by = $10, updated_at = now()
     where id = $1
     returning ${SELECT_COLUMNS}`,
    [
      id,
      input.strategyKey,
      input.source,
      input.name,
      input.subtitle,
      input.explanation,
      input.params,
      input.sessionWindow ?? null,
      input.warnings ?? null,
      updatedBy,
    ]
  );
  const row = result.rows[0];
  if (!row) throw new Error("setfile not found");
  return mapRow(row);
}

export async function setSetfileActive(id: string, active: boolean): Promise<void> {
  const result = await pool.query("update strategy_setfiles set active = $2 where id = $1", [id, active]);
  if (result.rowCount === 0) throw new Error("setfile not found");
}

export async function deleteSetfile(id: string): Promise<void> {
  const result = await pool.query("delete from strategy_setfiles where id = $1", [id]);
  if (result.rowCount === 0) throw new Error("setfile not found");
}

/** Swaps sort_order with the adjacent row (by current global order) in the given direction. */
export async function moveSetfile(id: string, direction: "up" | "down"): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const all = await client.query<{ id: string; sort_order: number }>(
      "select id, sort_order from strategy_setfiles order by sort_order for update"
    );
    const rows = all.rows;
    const index = rows.findIndex((r) => r.id === id);
    if (index === -1) throw new Error("setfile not found");
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= rows.length) {
      await client.query("commit");
      return;
    }
    const a = rows[index];
    const b = rows[swapIndex];
    await client.query("update strategy_setfiles set sort_order = $2 where id = $1", [a.id, b.sort_order]);
    await client.query("update strategy_setfiles set sort_order = $2 where id = $1", [b.id, a.sort_order]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
