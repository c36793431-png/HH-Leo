-- Client reach (coxwell 10-06 via marcus m61849/m61859/m61866/m61876). A client granted a trial, licence or
-- request must never go untold, and the admin must see when we cannot reach them.
--
-- users:
--   tg_last_dm_at / tg_last_dm_ok / tg_last_dm_error: the last Telegram DM notifyUser tried for this user and
--     what Telegram answered (ok, or e.g. "403 Forbidden: bot can't initiate conversation"). A Telegram login
--     with write access can get DMs without ever pressing Start, so bot_started alone can't say "reachable";
--     the admin badge and the client's "turn on notifications" prompt read this first, bot_started only when
--     no DM was ever tried. Never holds message text.
--   onboarding_goal / onboarding_goal_at: the welcome question's answer (dashboard quick-pick).
-- client_unreachable_alerts: one row per grant/approval/handled event that reached nobody (Telegram failed
--   or absent, email failed or absent). Written BEFORE the admin alert is sent, so it survives a failed send;
--   alert_sent_at records whether the approvals-topic alert went out. Vercel logs last an hour; this doesn't.
--   attempts: what each channel answered. Never a licence key, server IP or message text.
-- client_notices: dashboard banners for a client ("Your request is approved — next step"), dismissible.
-- basket_requests.reminded_at: the one admin reminder for a request still 'new' after 24h (idempotent).
--
-- APPLY BEFORE the code that reads these merges (marcus m61862: migration first, merge second).
-- Predecessor: 0096_feed_tier_trials_ld_base.sql (Leo, applied to prod 10-09 06:18Z; marcus m62162).
-- Rollback: 0097_rollback.sql.

alter table users
  add column if not exists tg_last_dm_at timestamptz,
  add column if not exists tg_last_dm_ok boolean,
  add column if not exists tg_last_dm_error text check (tg_last_dm_error is null or length(tg_last_dm_error) <= 300),
  add column if not exists onboarding_goal text check (onboarding_goal is null or onboarding_goal in ('prop_challenge', 'own_account', 'exploring')),
  add column if not exists onboarding_goal_at timestamptz;

create table if not exists client_unreachable_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  what text not null check (length(what) between 1 and 300),
  attempts jsonb not null default '[]'::jsonb,
  alert_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists client_unreachable_alerts_user_idx on client_unreachable_alerts (user_id, created_at desc);

create table if not exists client_notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('approved')),
  what text not null check (length(what) between 1 and 300),
  created_at timestamptz not null default now(),
  dismissed_at timestamptz
);
create index if not exists client_notices_open_idx on client_notices (user_id) where dismissed_at is null;

alter table basket_requests add column if not exists reminded_at timestamptz;

insert into schema_migrations (version, name) values
  ('0097', '0097_client_reach.sql')
on conflict (version) do nothing;
