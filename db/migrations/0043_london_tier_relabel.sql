-- Re-label London tiers by true FOC13 ranking, not latency order (marcus, addendum 2
-- to leo-london-tier-page-overhaul-2026-08-17). Coxwell flagged that "ENTRY" on Alpha
-- (#2 overall, 76.4/100) reads as beginner-tier when it's actually top-3 -- the composite
-- score rewards consistency + stream quality over raw speed, and Alpha trades speed for
-- both. Labels below reflect rank, not microseconds; latency_us/speed_display untouched
-- since the card ordering itself stays latency-ascending (Option B, unchanged).
update feed_tiers set
  subtitle = 'MOST RELIABLE',
  description = 'Our most consistent London feed -- steadier stream quality outweighs the extra microseconds. #2 overall on the Horizon Feed Comparison, behind only Black.'
where tier_key = 'ld-alpha-85';

update feed_tiers set
  subtitle = 'STANDARD',
  description = 'Balanced tier for strategies that need more headroom without going full low-latency. #4 overall on the Horizon Feed Comparison.'
where tier_key = 'ld-beta-56';

update feed_tiers set
  subtitle = 'SPEED-FOCUSED',
  description = 'Low-latency tier with a dedicated dual path -- fast, but ranks below tiers with steadier stream quality. #5 overall on the Horizon Feed Comparison.'
where tier_key = 'ld-gamma-19';

update feed_tiers set
  subtitle = 'FASTEST FIXED',
  description = 'Our fastest fixed-latency tier by raw speed, but stream quality is the tradeoff -- ranks #6 overall despite beating every tier but Ultra on latency.'
where tier_key = 'ld-delta-18';

update feed_tiers set
  subtitle = 'FLAGSHIP-LATENCY',
  description = 'Minimum achievable latency on our infrastructure, triple-path redundant with dedicated support. #3 overall on the Horizon Feed Comparison -- Alpha''s consistency edges it out for the top non-Black spot.'
where tier_key = 'ld-ultra';

insert into schema_migrations (version, name) values
  ('0043', '0043_london_tier_relabel.sql')
on conflict (version) do nothing;
