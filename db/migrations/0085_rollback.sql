-- 0085 applied to prod 2026-09-12 17:46Z; rollback for that apply.
--
-- Companion to 0085_client_heartbeats.sql. NOT applied automatically by that migration.
-- Written after the fact, on marcus's explicit ask (m48846, thread
-- leo-v1-hb-listen-only-build-2026-09-11), against the apply he ran via Neon MCP on
-- coxwell's go -- schema_migrations row 0085, applied_at 2026-09-12 17:46:51.813528+00,
-- table empty at that point.
--
-- Reverses 0085 in the opposite order: the two explicit indexes, then the table, then the
-- ledger row. `drop table` would take both indexes with it anyway -- they are named here so
-- that a partial apply (indexes created, table creation later reverted by hand) still has a
-- statement that names them, and so the reversal reads as the exact inverse of the forward
-- migration rather than relying on a cascade.
--
-- THIS IS DESTRUCTIVE IN A WAY 0085 WAS NOT. When 0085 was applied the table had 0 rows, so
-- reversing it immediately lost nothing. That stops being true the moment the first flush
-- lands: `drop table` takes every recorded beat with it, and there is no other copy -- the
-- Upstash buffer is cleared as each row is written and its hashes expire after 7 days.
-- Beats are not reconstructible from anywhere else. Check the row count before running this.
--
-- Not wrapped in begin/commit, unlike 0081_rollback.sql and 0082_rollback.sql: marcus ruled
-- this file is to be exactly the four statements drafted at m48837. Each is idempotent on its
-- own (`if exists` / a version-filtered delete), so a re-run after a partial failure is safe,
-- but a partial failure does not self-revert the way those two do.

drop index if exists client_heartbeats_last_seen_idx;
drop index if exists client_heartbeats_license_last_seen_idx;
drop table if exists client_heartbeats;
delete from schema_migrations where version = '0085';
