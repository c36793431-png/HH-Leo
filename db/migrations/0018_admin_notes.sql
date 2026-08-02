-- Freeform admin notes per user, shown on /admin/users/[id] between Profile
-- and Licenses. Last-edited-by/at is read from the existing admin_actions
-- audit table (admin_users_update_notes entries) rather than duplicated as
-- columns here, per coxwell's call.
alter table users add column if not exists admin_notes text;

insert into schema_migrations (version, name) values
  ('0018', '0018_admin_notes.sql')
on conflict (version) do nothing;
