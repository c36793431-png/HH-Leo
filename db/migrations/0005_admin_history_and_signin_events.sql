-- Admin panel v2 (bus thread horizon-portal-admin-panel-v2-2026-07-26):
-- /admin/history audit log + per-user signin history.
--
-- admin_actions already existed (0001_init.sql) -- extend it additively rather
-- than creating a new table, so existing logAdminAction() call sites keep working.
alter table admin_actions add column if not exists target_license_id uuid references licenses(id);

create index if not exists admin_actions_created_at_idx on admin_actions(created_at desc);
create index if not exists admin_actions_target_license_id_idx on admin_actions(target_license_id);
create index if not exists admin_actions_admin_user_id_idx on admin_actions(admin_user_id);

-- No prior signin tracking existed at all (sessions table only holds the
-- current JWT-adjacent session row, not history). Minimal append-only log,
-- written from the NextAuth signIn callback for both providers.
create table if not exists signin_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  created_at timestamptz not null default now()
);

create index if not exists signin_events_user_id_idx on signin_events(user_id, created_at desc);

insert into schema_migrations (version, name) values
  ('0005', '0005_admin_history_and_signin_events.sql')
on conflict (version) do nothing;
