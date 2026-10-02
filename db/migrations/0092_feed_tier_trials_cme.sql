-- Extend feed_tier_trials (0036, widened by 0038) to the CME tier (coxwell via marcus, m57688 +
-- m57767, bus thread portal-cme-admin-trial-2026-09-29). The admin queue may now grant a trial
-- on cme-ctrader-fix, and that trial must write its mirror row here so the expire-trials cron
-- and the provider Trials tab see it. Without this the row's INSERT fails the check AFTER the
-- grant has committed (activateTrialIfEligible is best-effort), leaving an untracked grant.
-- The region check already allows 'cme' (0036). Same shape as 0038: only the tier_key check
-- is widened. APPLY BEFORE the code that makes cme-ctrader-fix admin-trial-eligible merges.
alter table feed_tier_trials drop constraint if exists feed_tier_trials_tier_key_check;
alter table feed_tier_trials add constraint feed_tier_trials_tier_key_check
  check (tier_key in ('ld-alpha-85', 'ld-ultra', 'ny-normal', 'ny-fast', 'cme-ctrader-fix'));

insert into schema_migrations (version, name) values
  ('0092', '0092_feed_tier_trials_cme.sql')
on conflict (version) do nothing;
