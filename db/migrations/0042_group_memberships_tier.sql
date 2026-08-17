-- Prep for extending bot-issued single-use invite links to the free (Horizon Testers)
-- group, per marcus's answers on m21391 (bus thread leo-portal-updates-bundle-2026-08-17):
-- gate mechanism is bot-issued invite links for BOTH tiers. group_memberships previously
-- only ever tracked the paid group (hardcoded chat_id default); tag existing/future rows
-- by tier so one table can serve both once the free group's chat_id is known.
alter table group_memberships add column if not exists tier text not null default 'paid'
  check (tier in ('free', 'paid'));

alter table group_memberships alter column chat_id drop default;

insert into schema_migrations (version, name) values
  ('0042', '0042_group_memberships_tier.sql')
on conflict (version) do nothing;
