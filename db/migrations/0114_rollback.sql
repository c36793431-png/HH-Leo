-- Rollback for 0114_horizonone_app_grants.sql. Not applied automatically.
-- Revokes only what 0114 granted. A table-level REVOKE also removes the column-level INSERT and UPDATE grants on
-- signal_calls. The role itself is marcus's: drop it on prod if it should go too (cutover S1 rollback, plan
-- m69115). Horizon One's reads and writes start failing with "permission denied".
begin;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'horizonone_app') then
    revoke select, insert, update on signal_calls from horizonone_app;
    if to_regclass('horizonone_login_attempts') is not null then
      revoke select, insert, update, delete on horizonone_login_attempts from horizonone_app;
    end if;
  end if;
end $$;
delete from schema_migrations where version = '0114';
commit;
