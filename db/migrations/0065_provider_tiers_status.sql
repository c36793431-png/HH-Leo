-- provider_tiers status enum + trial/pause fields (bus thread
-- feed-admin-dashboard-build-2026-08-24, Iris's spec reply). Roster shell
-- shipped 1a114e8/6fdca58 without status/uptime columns to avoid fabricating
-- state (see that thread's memory) -- this is the scoped follow-up that makes
-- the "trial" filter and a real status column possible.
--
-- Three values, matching Iris's definitions:
--   live   -- terms confirmed, tier active and serving subscribers.
--   trial  -- within a trial window (trial_expires_at set and in the future).
--   paused -- admin- or provider-initiated suspension: no new subscribers,
--             existing subscriptions frozen (not cancelled).
--
-- pause_reason is admin-only/never exposed to the provider or public roster,
-- same visibility discipline as provider_tier_proposals.declined_note (0061/0062).
--
-- Existing rows default to 'live' -- every current provider_tiers row was
-- created by register-provider's confirmed-terms path (0060), so 'live' is
-- the correct backfill value, not a placeholder guess.

alter table provider_tiers
  add column status text not null default 'live',
  add column trial_expires_at timestamptz,
  add column paused_at timestamptz,
  add column paused_by uuid references users(id),
  add column pause_reason text;

alter table provider_tiers
  add constraint provider_tiers_status_check
  check (status in ('live', 'trial', 'paused'));

insert into schema_migrations (version, name) values
  ('0065', '0065_provider_tiers_status.sql')
on conflict (version) do nothing;
