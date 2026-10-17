-- Rollback for 0116_consultant_profiles.sql. Not applied automatically.
-- Roll the CODE back first: the dashboard profile editor, the apply form's service types and the marketplace read
-- these. Refuses while any profile exists, or while any application states a service type: both are providers' own
-- submissions, so dropping them is a decision, not something a rollback does silently (0112_rollback pattern).
begin;
do $$
begin
  if exists (select 1 from consultant_profiles) then
    raise exception '0116 rollback: consultant_profiles has rows; remove them first';
  end if;
  if exists (select 1 from consultant_applications where service_types <> '{}' or service_other is not null) then
    raise exception '0116 rollback: consultant_applications rows state service types; clear them first';
  end if;
end $$;
drop table if exists consultant_profiles;
alter table consultant_applications drop constraint if exists consultant_applications_service_other_iff_other;
alter table consultant_applications drop column if exists service_other;
alter table consultant_applications drop column if exists service_types;
delete from schema_migrations where version = '0116';
commit;
