-- Coxwell correction to the institutional/retail segment split (marcus,
-- leo-tiers-institutional-retail-labels-2026-08-21): preserve the "LATENCY" framing
-- that was on FLAGSHIP-LATENCY -- these are latency tiers segmented by market, not
-- generic pricing tiers. LD Ultra's badge becomes INSTITUTIONAL LATENCY (was
-- INSTITUTIONAL, set in 0050). Black's badge is display-only in page.tsx (not backed
-- by feed_tiers), so it doesn't need a DB row here.
update feed_tiers set
  subtitle = 'INSTITUTIONAL LATENCY'
where tier_key = 'ld-ultra';

insert into schema_migrations (version, name) values
  ('0051', '0051_institutional_retail_latency_labels.sql')
on conflict (version) do nothing;
