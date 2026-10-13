import { Pool, type PoolClient } from "@neondatabase/serverless";

/** What a *On(db) variant writes through: the pool, or a client inside the caller's transaction. */
export type Db = Pick<PoolClient, "query">;

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

export const pool =
  global._pgPool ??
  new Pool({ connectionString: process.env.NEON_DATABASE_URL });

if (process.env.NODE_ENV !== "production") {
  global._pgPool = pool;
}
