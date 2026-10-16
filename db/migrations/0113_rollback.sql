-- Rollback for 0113_horizonone_login_attempts.sql. Not applied automatically.
-- Roll 0114 back first (0114_rollback.sql): this refuses while 0114's ledger row exists, so the grants are never
-- left pointing at a dropped table by accident. The rows are throwaway counters (24 h at most), so unlike
-- 0110_rollback this does not refuse on rows. Roll the Horizon One login code back first: it writes this table.
begin;
do $$
begin
  if exists (select 1 from schema_migrations where version = '0114') then
    raise exception '0113 rollback: 0114 is applied; run 0114_rollback.sql first';
  end if;
end $$;
drop table if exists horizonone_login_attempts;
delete from schema_migrations where version = '0113';
commit;
