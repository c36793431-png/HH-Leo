-- Rollback for 0105_consult_services_requests.sql. Not applied automatically.
-- Roll the CODE back first: the Consulting section, package pages, Ask form and admin queues read these tables.
-- Refuses while any client request or consultant-proposed service exists: those are clients' and consultants'
-- own submissions, and deleting them is a decision, not something a rollback does silently. Remove them by hand
-- first. The seeded house packages are dropped with the table; re-applying 0105 re-seeds them.
begin;
do $$
begin
  if exists (select 1 from consult_requests) then
    raise exception '0105 rollback: consult_requests has rows; remove them first';
  end if;
  if exists (select 1 from consult_services where owner_user_id is not null) then
    raise exception '0105 rollback: consult_services has consultant-owned rows; remove them first';
  end if;
end $$;
drop table if exists consult_requests;
drop table if exists consult_services;
delete from schema_migrations where version = '0105';
commit;
