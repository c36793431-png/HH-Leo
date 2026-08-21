-- Rename NY tier display names to match London's Greek-letter convention
-- (coxwell via marcus, leo-ny-tier-rename-to-alpha-beta-2026-08-21).
-- NY Fast -> NY Alpha, NY Normal -> NY Beta. Card subtitles (STANDARD/LOW LATENCY)
-- and tier_key values are unchanged.

update feed_tiers set name = 'NY Alpha' where region_key = 'ny' and tier_key = 'ny-fast';
update feed_tiers set name = 'NY Beta' where region_key = 'ny' and tier_key = 'ny-normal';

insert into schema_migrations (version, name) values
  ('0049', '0049_ny_tier_names_alpha_beta.sql')
on conflict (version) do nothing;
