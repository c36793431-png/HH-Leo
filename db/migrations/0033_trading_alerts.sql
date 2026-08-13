-- Persists every /v1/hft-alert hit (src/app/v1/hft-alert/route.ts) so the client
-- Dashboard can show a Recent Alerts panel, not just relay to Telegram DM.
-- Retention (90 days) is enforced in application code (pruneOldTradingAlerts,
-- called from the daily expire-licenses cron), not a DB-level policy.
create table if not exists trading_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  license_id uuid references licenses(id) on delete set null,
  alert_type text not null,
  message text not null,
  symbol text,
  pnl text,
  strategy text,
  created_at timestamptz not null default now()
);

create index if not exists trading_alerts_user_id_created_at_idx
  on trading_alerts(user_id, created_at desc);

insert into schema_migrations (version, name) values
  ('0033', '0033_trading_alerts.sql')
on conflict (version) do nothing;
