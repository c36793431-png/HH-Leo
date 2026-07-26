-- 0003: schema_migrations ledger.
--
-- Records which numbered migrations under db/migrations/ have been applied to
-- this database. Before this file existed there was no record at all, so the
-- rows for 0001 and 0002 are a backfill: their applied_at is the timestamp of
-- THIS migration, not the (unknown) time they originally ran. Verified against
-- the live database on 2026-07-26 -- every 0001 table was present and
-- users.name existed, so both are genuinely applied.
--
-- CONVENTION going forward: every migration file ends with its own insert into
-- schema_migrations, so applying the file is what records it. No external
-- runner is required and no migration can be applied without being logged.
--
-- Idempotent: safe to re-run.

create table if not exists schema_migrations (
  version    text primary key,
  name       text not null,
  applied_at timestamptz not null default now()
);

comment on table schema_migrations is
  'Applied-migration ledger: one row per db/migrations/NNNN_*.sql. Rows for 0001 and 0002 were backfilled by 0003; their applied_at is the backfill time, not the original apply time.';

insert into schema_migrations (version, name) values
  ('0001', '0001_init.sql'),
  ('0002', '0002_add_user_name.sql'),
  ('0003', '0003_schema_migrations_ledger.sql')
on conflict (version) do nothing;
