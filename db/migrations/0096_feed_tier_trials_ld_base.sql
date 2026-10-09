-- Extend feed_tier_trials (0036, widened by 0038 and 0092) to the three LD Base tiers (coxwell,
-- topic #458, 2026-10-07; marcus m62102, bus room leo-ld-base-trial-2026-10-09). The admin queue
-- may now grant a trial on ld-beta-56 / ld-gamma-19 / ld-delta-18, and that trial must write its
-- mirror row here so the expire-trials cron and the provider Trials tab see it. Without this the
-- row's INSERT fails the check AFTER the grant has committed (activateTrialIfEligible is
-- best-effort), leaving an untracked grant. The region check already allows 'london' (0036).
-- Same shape as 0092: only the tier_key check is widened, every existing key is kept.
-- APPLY BEFORE the code that makes the LD Base tiers admin-trial-eligible merges.
alter table feed_tier_trials drop constraint if exists feed_tier_trials_tier_key_check;
alter table feed_tier_trials add constraint feed_tier_trials_tier_key_check
  check (tier_key in ('ld-alpha-85', 'ld-ultra', 'ny-normal', 'ny-fast', 'cme-ctrader-fix',
                      'ld-beta-56', 'ld-gamma-19', 'ld-delta-18'));

insert into schema_migrations (version, name) values
  ('0096', '0096_feed_tier_trials_ld_base.sql')
on conflict (version) do nothing;
