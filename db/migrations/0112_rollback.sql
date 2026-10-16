-- Rollback for 0112_consultant_applications.sql. Not applied automatically.
-- Roll the CODE back first: the apply page, the admin queue and the consult host write or read this table.
-- Refuses while any application exists: those are applicants' own submissions and approved rows are the
-- consultant permission (ruling 3, marcus m69004), so deleting them is a decision, not something a rollback does
-- silently. Remove them by hand first (0105_rollback pattern).
begin;
do $$
begin
  if exists (select 1 from consultant_applications) then
    raise exception '0112 rollback: consultant_applications has rows; remove them first';
  end if;
end $$;
drop table if exists consultant_applications;
delete from schema_migrations where version = '0112';
commit;
