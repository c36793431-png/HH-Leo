-- Horizon One login rate limit (Horizon One own-app plan, B1; marcus BUILD GO m69582). Plain DDL, no role reference:
-- fable m69580 S3 keeps this table OUT of the 0104-shaped grants file, because a 0104 guard skips with a NOTICE and
-- no ledger row, so a CREATE TABLE inside it would exist unledgered and the re-run would hit a duplicate table.
-- The grants for horizonone_app on this table are in 0114_horizonone_app_grants.sql.
--
-- One row per (key, fixed 15-minute window) holding that window's FAILED logins (marcus m69144: key, window start,
-- count; m69148: 5 failed attempts per 15 min per key):
-- key: lower-case hex HMAC-SHA256 of the client IP, keyed with env HORIZONONE_RL_KEY (marcus m69148, which replaces
--   the plain sha256(IP) of m69144). The IP is the first x-forwarded-for hop (fable m69580 N5, the rule of
--   src/lib/signal-ingest.ts:110). No IP is stored.
-- window_start: start of the window, on 15-minute boundaries from the epoch.
-- The primary key is the index on key + window that fable m69580 S3 asks for.
-- Retention: the app deletes rows older than 24 h inside its own transaction (marcus m69148); nothing here does.
--
-- Additive only, one new table. Rollback: 0113_rollback.sql.
begin;

create table if not exists horizonone_login_attempts (
  key text not null check (key ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  failures integer not null check (failures > 0),
  constraint horizonone_login_attempts_pkey primary key (key, window_start)
);

insert into schema_migrations (version, name) values
  ('0113', '0113_horizonone_login_attempts.sql')
on conflict (version) do nothing;

commit;
