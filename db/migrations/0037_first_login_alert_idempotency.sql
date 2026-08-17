-- Idempotency guard for the "first login" telemetry sink alert. The prior
-- check-then-act (count signin_events, then notify) was racy: two concurrent
-- signIn callback invocations (e.g. a resend magic-link clicked twice) could
-- both observe zero prior signins before either insert landed, firing the
-- alert twice. A unique row claimed via ON CONFLICT DO NOTHING makes the
-- "have we already alerted this user" check atomic.
create table if not exists first_login_alerts (
  user_id uuid primary key references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into schema_migrations (version, name) values
  ('0037', '0037_first_login_alert_idempotency.sql')
on conflict (version) do nothing;
