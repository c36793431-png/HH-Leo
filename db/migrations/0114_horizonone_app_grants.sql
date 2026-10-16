-- horizonone_app: least-privilege grants for the Horizon One app (Horizon One own-app plan part 1 section 2,
-- m69114; marcus rulings m69121 Q4 + m69144; fable m69580 S3 = 0104's shape exactly). GRANT-only, additive.
-- The role is marcus's to create on prod, never this file's (m69121 Q4): the repo is public, so no CREATE ROLE
-- and no password here.
-- The role also needs CONNECT on the database and USAGE on schema public. Both come from PUBLIC (the defaults
-- 0104 relies on too), so nothing here grants them.
-- Guards. Each one raises a NOTICE, grants nothing and does NOT write the schema_migrations row, so the drift
-- check keeps naming 0114 until a re-run lands it:
--   1. horizonone_app does not exist.
--   2. horizonone_app is SUPERUSER or BYPASSRLS, or a member of neon_superuser, neondb_owner (owner = full rights),
--      pg_read_all_data or pg_write_all_data (direct or through another role), so these grants would not be its
--      boundary (0104's guard 2).
-- Needs 0110 (signal_calls) and 0113 (horizonone_login_attempts): with either missing, the GRANT fails, the
-- block aborts and no ledger row is written.
-- signal_calls is granted by column for writes, from src/lib/signal-ingest.ts at 916ce1c:
--   INSERT: the 15 columns of the insert at :306-307; id, received_at and updated_at take their defaults.
--   UPDATE: the 10 columns the fill/score statement sets at :363-377.
--   SELECT on the table: the page read (src/lib/signal-calls.ts:89) and the ingest lookup (signal-ingest.ts:293-297).
--   No DELETE, TRUNCATE, REFERENCES or TRIGGER. A column added to signal_calls later is not writable until granted.
-- horizonone_login_attempts: SELECT, INSERT, UPDATE, DELETE (marcus m69144), the delete being the 24 h prune.
-- No other table: no users, user_roles, sessions or schema_migrations. No default privileges.
-- Rollback: 0114_rollback.sql.
do $$
declare
  v_oid oid;
  v_super boolean;
  v_bypassrls boolean;
  v_wide text;
begin
  select oid, rolsuper, rolbypassrls into v_oid, v_super, v_bypassrls from pg_roles where rolname = 'horizonone_app';
  if v_oid is null then
    raise notice '0114 skipped: role horizonone_app does not exist. Nothing granted, schema_migrations not written.';
    return;
  end if;
  if v_super or v_bypassrls then
    raise notice '0114 skipped: horizonone_app is SUPERUSER or BYPASSRLS. Nothing granted, schema_migrations not written.';
    return;
  end if;
  select string_agg(g.rolname, ', ' order by g.rolname) into v_wide
    from pg_roles g
   where g.rolname in ('neon_superuser', 'neondb_owner', 'pg_read_all_data', 'pg_write_all_data')
     and pg_has_role(v_oid, g.oid, 'MEMBER');
  if v_wide is not null then
    raise notice '0114 skipped: horizonone_app is a member of % and can already read and write every table. Nothing granted, schema_migrations not written.', v_wide;
    return;
  end if;

  grant select on signal_calls to horizonone_app;
  grant insert (source, symbol, session_date, direction, entry_ts, exit_ts, entry_px, entry_bar_ts, entry_px_at,
    exit_px, exit_bar_ts, move, outcome, scored_at, meta) on signal_calls to horizonone_app;
  grant update (entry_px, entry_bar_ts, entry_px_at, meta, exit_px, exit_bar_ts, move, outcome, scored_at,
    updated_at) on signal_calls to horizonone_app;
  grant select, insert, update, delete on horizonone_login_attempts to horizonone_app;

  insert into schema_migrations (version, name) values
    ('0114', '0114_horizonone_app_grants.sql')
  on conflict (version) do nothing;
  raise notice '0114 applied: SELECT + INSERT on 15 columns + UPDATE on 10 columns of signal_calls, and SELECT, INSERT, UPDATE, DELETE on horizonone_login_attempts granted to horizonone_app.';
end $$;
