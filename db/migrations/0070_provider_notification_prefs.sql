-- Per-provider, per-event notification preferences (bus thread
-- provider-notification-prefs-2026-08-29). Backs the ten event toggles on the
-- Notifications page (src/app/feed/dashboard/notifications/page.tsx), which until now
-- were decorative -- there was no table for them to read from or write to.
--
-- Keyed by user_id, not a separate "provider id" -- feed providers are just users with
-- role='feed_provider' (0058), and every other per-provider table in this app
-- (telegram_bot_links 0068, provider_tiers 0060) already keys off user_id/provider_user_id
-- the same way.
--
-- Absent row means enabled: a provider who has just linked, or who predates this table
-- entirely, gets every event without configuring anything first, matching the toggle
-- states the UI already showed before this table existed. A row only needs to exist once
-- a provider actually flips something to off.
create table if not exists provider_notification_prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  event_key text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (user_id, event_key)
);

create index if not exists provider_notification_prefs_user_id_idx
  on provider_notification_prefs(user_id);

insert into schema_migrations (version, name) values
  ('0070', '0070_provider_notification_prefs.sql')
on conflict (version) do nothing;
