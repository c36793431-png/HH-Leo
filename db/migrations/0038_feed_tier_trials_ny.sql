-- Extend feed_tier_trials (0036) to NY tiers (marcus/coxwell, bus thread
-- leo-ny-feed-trial-option-2026-08-15). NY has only 2 tiers total (ny-normal, ny-fast) --
-- no middle tier like London -- so both are trial-eligible, mirroring the entry+flagship
-- pattern from LD Alpha/LD Ultra. Same 7-day trial length, same backend/UI (already
-- region-generic); this migration only widens the tier_key check constraint.
alter table feed_tier_trials drop constraint if exists feed_tier_trials_tier_key_check;
alter table feed_tier_trials add constraint feed_tier_trials_tier_key_check
  check (tier_key in ('ld-alpha-85', 'ld-ultra', 'ny-normal', 'ny-fast'));

insert into schema_migrations (version, name) values
  ('0038', '0038_feed_tier_trials_ny.sql')
on conflict (version) do nothing;
