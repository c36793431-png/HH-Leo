-- *** APPLIED IN PRODUCTION 2026-09-12 17:46:51Z -- do not re-run. ***
-- Applied by marcus via Neon MCP on coxwell's go (17:41Z), per standing policy: Leo writes
-- migrations, marcus applies them. Verified post-apply from information_schema/pg_indexes --
-- 16 columns, pkey + the unique (license_key, hwid) + the two indexes below, 0 rows.
-- Reversal is db/migrations/0085_rollback.sql (destructive once beats have landed; see it).
-- Bus thread leo-v1-hb-listen-only-build-2026-09-11.
--
-- WHO WRITES THIS TABLE: /api/cron/flush-heartbeats, NOT /v1/hb. The original merge order
-- here ("the /v1/hb route must NOT merge before this is applied: the route's only write
-- target is this table") stopped being true at ea7fc95, which took Postgres off the beat
-- path -- /v1/hb now buffers into Upstash and returns 204 without touching the DB, and the
-- */30 cron drains the buffer and does the upsert. With this applied the point is moot, but
-- the sequencing it described is not the one that was shipped: a merge ahead of the apply
-- would not have broken the customer-facing endpoint, only made the sweep catch 42P01 and
-- re-queue until the table existed.
--
-- What this is for: /v1/hb, the desktop client's heartbeat. Every shipped build v2.0.2-v2.0.5
-- POSTs it (one POST per open trading tab, 45s warm-up then every 180s) and the portal has
-- never had the route -- it has been 404ing for real licensed customers. coxwell ruled the
-- endpoint LISTEN-ONLY (FOC12, 21:02Z 2026-09-11): the portal records the beat and returns 204
-- with an empty body, never an `adj` and never any instruction. The remote price-adjust lever
-- the old scaffold contemplated is NOT being built; FOC12 is removing the client-side `adj`
-- parse in v2.0.6 independently. Nothing this table feeds changes trading behaviour.
--
-- GRAIN: one row per (license_key, hwid), NOT one row per beat. At 20 beats/hr/tab a per-beat
-- log is unbounded growth for no extra signal, so the flush upserts on that pair, bumping
-- last_seen and beat_count and overwriting the telemetry columns with the latest beat's values.
-- No separate raw per-beat log table is created -- deliberately skipped, not forgotten.
--
-- "LATEST BEAT", NOT "LAST KNOWN VALUE": client_version, d1/d2/d3, sp, exe_hash, ip and raw are
-- overwritten unconditionally by each beat, including with NULL when that beat did not carry the
-- field. They are read as "what this (key, hwid) reported at last_seen", so a value coalesced
-- forward from an older beat would be a false statement about that timestamp. IP history is not
-- lost by this -- connection_ips (0031) keeps the change log, and the flush feeds it.
--
-- raw jsonb holds the latest beat's whole body (capped in /v1/hb, before it buffers). It is
-- bounded by the upsert grain -- one body per key/hwid, not per beat. Kept because no beat has
-- ever reached a server: the field shapes below are FOC12's reading of TradingTabInstance.cs,
-- not observed traffic, so if d1/d2/d3 or sp arrive in a shape the typed columns can't hold,
-- raw is what makes that recoverable instead of silently null.
--
-- NO FOREIGN KEY on license_id/user_id, by design (marcus's explicit ask). An unknown or
-- deleted license key must still record -- a beat from a key that resolves to nothing is the
-- signal, not an error -- and an FK would either reject that row or cascade-delete history we
-- want to keep. license_key is stored as plain text alongside the resolved id for exactly that
-- reason. Consumers must treat license_id as a soft reference and left join.
--
-- ip is text, not inet, matching connection_ips.ip and geoip_cache.ip (0031). Not cosmetic:
-- clientIp() returns the literal string "unknown" when there is no x-forwarded-for, which an
-- inet column would reject with 22P02. The route maps "unknown" to NULL, but the column type
-- stays consistent with the two IP columns already in this schema.
--
-- This endpoint is UNAUTHENTICATED (listen-only, nothing to protect on the way out), so anyone
-- can create rows here by POSTing novel (lk, hwid) pairs. Row creation is bounded only by the
-- per-IP heartbeat limiter in src/lib/rate-limit.ts (1200/hr) -- flagged to marcus, not solved
-- here. If this table ever grows in a way that looks adversarial rather than customer-shaped,
-- the fix is a cap on distinct unresolved keys, not a schema change.

create table if not exists client_heartbeats (
  id uuid primary key default gen_random_uuid(),
  -- Identity as sent by the client. The client's JSON keys are lk/hid/v -- NOT the
  -- key/hwid/version in the withheld f8d1dcd docstring, which is stale.
  license_key text not null,
  hwid text not null,
  -- Resolved at FLUSH time from licenses.license_key, not at beat time (ea7fc95): the beat
  -- only buffers. NULL = key matched nothing. No FK: see above.
  license_id uuid,
  user_id uuid,
  client_version text,
  -- Anti-tamper telemetry. Stored, never acted on: d1/d2/d3 are the client's debugger flags,
  -- sp the names of any reversing/proxy tools it saw running, exe_hash its own binary hash.
  -- sp is jsonb because the client's shape (string vs array) has never been observed.
  d1 boolean,
  d2 boolean,
  d3 boolean,
  sp jsonb,
  exe_hash text,
  ip text,
  raw jsonb,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  -- Beats RECORDED, not beats sent: a beat dropped by the rate limiter never increments this.
  beat_count bigint not null default 1,
  unique (license_key, hwid)
);

-- Admin lookups: "show me this licence's clients, most recently seen first". Partial because
-- unresolved-key rows have nothing to look up by.
create index if not exists client_heartbeats_license_last_seen_idx
  on client_heartbeats (license_id, last_seen desc)
  where license_id is not null;

-- Ops sweep: "what has beaten recently", across resolved and unresolved keys alike.
create index if not exists client_heartbeats_last_seen_idx
  on client_heartbeats (last_seen desc);

insert into schema_migrations (version, name) values
  ('0085', '0085_client_heartbeats.sql')
on conflict (version) do nothing;
