-- Rollback for 0117_release_notices.sql. Not applied automatically.
-- Roll the CODE back first: the admin release-notices page, the send engine and /unsubscribe/updates read these.
-- Refuses while any run or delivery exists (they are the audit of what was sent to whom) or while any user has opted
-- out (that is a person's own choice): dropping either is a decision, not something a rollback does silently
-- (0112/0116 rollback pattern).
begin;
do $$
begin
  if exists (select 1 from release_notice_deliveries) then
    raise exception '0117 rollback: release_notice_deliveries has rows; remove them first';
  end if;
  if exists (select 1 from release_notice_runs) then
    raise exception '0117 rollback: release_notice_runs has rows; remove them first';
  end if;
  if exists (select 1 from users where release_updates_opt_out_at is not null) then
    raise exception '0117 rollback: users have opted out of release updates; clear release_updates_opt_out_at first';
  end if;
end $$;
drop table if exists release_notice_deliveries;
drop table if exists release_notice_runs;
alter table users drop column if exists release_updates_opt_out_at;
delete from schema_migrations where version = '0117';
commit;
