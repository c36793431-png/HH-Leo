-- Deep-link tokens for per-bot Telegram linking (bus thread
-- provider-telegram-linking-build-2026-08-28). Mirrors 0032's
-- hft_alert_onboarding_tokens shape but scoped by bot_key instead of being a
-- one-off table for a single bot, so it works for telegram_bot_links (0068)
-- generally -- starting with the shared provider bot (@HorizonFeedsBot,
-- bot_key 'horizon_feeds_bot'), and any per-provider bots added later without
-- another migration.
create table if not exists telegram_bot_link_tokens (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  bot_key text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  expires_at timestamptz not null
);

create index if not exists telegram_bot_link_tokens_user_id_idx
  on telegram_bot_link_tokens(user_id);

insert into schema_migrations (version, name) values
  ('0069', '0069_telegram_bot_link_tokens.sql')
on conflict (version) do nothing;
