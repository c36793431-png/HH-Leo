-- Rollback for 0110_signal_calls.sql. Not applied automatically.
-- Roll the CODE back first: the ingest route and /admin/signals read and write signal_calls.
-- Refuses while any signal_calls row exists: received_at, entry_px_at and scored_at are the portal's clock at
-- first receipt and cannot be re-created by re-posting, so deleting them is a decision, not something a rollback
-- does silently. Remove them by hand first (the trigger does not block DELETE).
begin;
do $$
begin
  if exists (select 1 from signal_calls) then
    raise exception '0110 rollback: signal_calls has rows; remove them first';
  end if;
end $$;
drop table if exists signal_calls;
drop function if exists signal_calls_guard_update();
delete from schema_migrations where version = '0110';
commit;
