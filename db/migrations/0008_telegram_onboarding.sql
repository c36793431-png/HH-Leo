-- Phase 1 of paid-user onboarding automation.
--
-- users.telegram_user_id (from 0001) is set when a user links via the Telegram
-- login widget — proof they own the account, but NOT proof they've pressed
-- /start on the bot. Telegram requires a user to /start a bot before it can DM
-- them, so telegram_bot_started_at tracks that separate, later event.
alter table users add column if not exists telegram_bot_started_at timestamptz;

-- Opaque one-time-use tokens embedded in a t.me/<bot>?start=onb_<token> deep
-- link so the /start webhook can identify which portal user pressed Start.
create table if not exists telegram_onboarding_tokens (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  expires_at timestamptz not null
);

create index if not exists telegram_onboarding_tokens_user_id_idx
  on telegram_onboarding_tokens(user_id);

insert into schema_migrations (version, name) values
  ('0008', '0008_telegram_onboarding.sql')
on conflict (version) do nothing;
