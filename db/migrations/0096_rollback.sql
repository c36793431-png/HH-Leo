-- Rollback for 0096_feed_tier_trials_ld_base.sql. Not applied automatically.
-- Re-adds 0092's five-key check. It FAILS (check violation, nothing changed) if any
-- feed_tier_trials row has tier_key 'ld-beta-56', 'ld-gamma-19' or 'ld-delta-18', because the
-- re-added check validates existing rows. That is deliberate: such a row is a live or historical
-- LD Base trial, and deleting it would hide a grant from the cron and the Trials tab. Decide those
-- rows first. Also roll back the code first, or the admin queue can grant an LD Base trial again
-- whose mirror INSERT then fails after commit.
begin;
alter table feed_tier_trials drop constraint if exists feed_tier_trials_tier_key_check;
alter table feed_tier_trials add constraint feed_tier_trials_tier_key_check
  check (tier_key in ('ld-alpha-85', 'ld-ultra', 'ny-normal', 'ny-fast', 'cme-ctrader-fix'));
delete from schema_migrations where version = '0096';
commit;
