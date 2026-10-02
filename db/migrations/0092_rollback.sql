-- Rollback for 0092_feed_tier_trials_cme.sql. Not applied automatically.
-- Re-adds 0038's four-key check. It FAILS (check violation, nothing changed) if any
-- feed_tier_trials row has tier_key 'cme-ctrader-fix', because the re-added check validates
-- existing rows. That is deliberate: such a row is a live or historical CME trial, and
-- deleting it would hide a grant from the cron and the Trials tab. Decide those rows first.
-- Also roll back the code first, or the admin queue can grant a CME trial again whose mirror
-- INSERT then fails after commit.
begin;
alter table feed_tier_trials drop constraint if exists feed_tier_trials_tier_key_check;
alter table feed_tier_trials add constraint feed_tier_trials_tier_key_check
  check (tier_key in ('ld-alpha-85', 'ld-ultra', 'ny-normal', 'ny-fast'));
delete from schema_migrations where version = '0092';
commit;
