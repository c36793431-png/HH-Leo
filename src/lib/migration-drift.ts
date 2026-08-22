import fs from "fs/promises";
import path from "path";
import { pool } from "./db";

const MIGRATIONS_DIR = path.join(process.cwd(), "db/migrations");

/** Matches the leading version token of a migration filename, e.g. "0057" or "0054a". */
const VERSION_RE = /^([0-9]{4}[a-z]?)_/;

export interface MigrationDrift {
  /** Migration files on disk with no corresponding schema_migrations row. */
  missing: string[];
  checkedFiles: number;
  checkedRows: number;
}

/**
 * Compares db/migrations/*.sql filenames against schema_migrations rows.
 * A file with no row means the migration was shipped in code but never applied
 * (or applied without its own insert) -- exactly how 0057_pending_signups.sql
 * silently ate 25 signups' name/telegram fields before anyone noticed.
 */
export async function checkMigrationDrift(): Promise<MigrationDrift> {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  const fileVersions = entries
    .map((name) => VERSION_RE.exec(name)?.[1])
    .filter((v): v is string => Boolean(v));

  const { rows } = await pool.query<{ version: string }>("select version from schema_migrations");
  const applied = new Set(rows.map((r) => r.version));

  const missing = fileVersions.filter((v) => !applied.has(v)).sort();

  return { missing, checkedFiles: fileVersions.length, checkedRows: rows.length };
}
