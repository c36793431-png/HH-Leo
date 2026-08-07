-- Idempotency guard for cron-driven telemetry sink events (license expiring-soon / expired
-- lifecycle notifications) so a cron run that fires twice in one day doesn't double-send.
create table if not exists lifecycle_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  event_type text not null,
  event_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, event_type, event_date)
);

insert into schema_migrations (version, name) values
  ('0029', '0029_lifecycle_notification_idempotency.sql')
on conflict (version) do nothing;
