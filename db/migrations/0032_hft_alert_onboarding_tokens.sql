-- Deep-link tokens for the Trading Alerts activation surface (@alerts73_bot).
-- Mirrors 0008_telegram_onboarding.sql's telegram_onboarding_tokens table but
-- scoped to the separate alert bot so a token minted for one bot can't be
-- replayed against the other.
create table if not exists hft_alert_onboarding_tokens (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  expires_at timestamptz not null
);

create index if not exists hft_alert_onboarding_tokens_user_id_idx
  on hft_alert_onboarding_tokens(user_id);

insert into schema_migrations (version, name) values
  ('0032', '0032_hft_alert_onboarding_tokens.sql')
on conflict (version) do nothing;
