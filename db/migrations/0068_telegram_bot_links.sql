-- Per-bot Telegram identity storage (leo-provider-onboarding-copy-and-bot-storage-2026-08-28).
-- users.telegram_user_id / users.telegram_username (0001_init.sql) stay exactly as they are --
-- the shared slot already read/written by the portal bot (HORIZON_PORTAL_BOT_TOKEN) and
-- alerts73_bot (TELEGRAM_HFT_ALERT_BOT_TOKEN, see telegram-hft-alert-bot.ts's own comment: "the
-- same column every other Telegram feature already uses"). This migration does not touch that
-- column or either bot's webhook.
--
-- This table is for bots that need a link scoped to themselves instead of sharing the users
-- columns -- starting with the shared provider bot (@horizonfbot, one bot for all feed
-- providers in v1 per coxwell) so wiring up provider Telegram linking never collides with
-- alerts73_bot's existing linkage the way a naive copy of that pattern would. Per-provider bots
-- later are just additional bot_key values in this same table, not a schema change.
create table if not exists telegram_bot_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  bot_key text not null,
  telegram_user_id bigint not null,
  telegram_username text,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bot_key, telegram_user_id),
  unique (user_id, bot_key)
);

create index if not exists telegram_bot_links_user_id_idx on telegram_bot_links(user_id);

insert into schema_migrations (version, name) values
  ('0068', '0068_telegram_bot_links.sql')
on conflict (version) do nothing;
