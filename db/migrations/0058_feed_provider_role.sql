-- Feed Providers Panel (feed.horizonhft.com), bus thread
-- leo-provider-panel-implementation-2026-08-22, coxwell greenlit, Iris design approved.
-- Adds the 'feed_provider' role (mirrors 0044's partner-role pattern) plus a nullable
-- ownership link on feed_tiers so an existing tier can be assigned to a provider account.
-- feed_tiers today models Horizon's own regional latency catalogue (London/NY) with no
-- vendor-ownership concept -- provider_user_id lets admin designate which tiers a given
-- feed_provider account manages, without duplicating feed_tiers/feed_tier_requests/
-- feed_tier_trials (flagged + confirmed with marcus before writing this, m24027).

alter table users drop constraint users_role_check;
alter table users add constraint users_role_check
  check (role in ('user', 'admin', 'partner', 'feed_provider'));

alter table feed_tiers add column if not exists provider_user_id uuid references users(id) on delete set null;
create index if not exists feed_tiers_provider_idx on feed_tiers (provider_user_id);

insert into schema_migrations (version, name) values
  ('0058', '0058_feed_provider_role.sql')
on conflict (version) do nothing;
