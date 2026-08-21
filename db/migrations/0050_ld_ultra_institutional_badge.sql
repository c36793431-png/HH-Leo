-- Rename LD Ultra's top-of-card badge from FLAGSHIP-LATENCY to INSTITUTIONAL
-- (marcus/coxwell, leo-tiers-institutional-retail-labels-2026-08-21). Pairs LD Ultra
-- with Black as the two $10k+ institutional tiers on /feeds/london/tiers; segment split
-- itself (institutional vs retail) is driven by a tier-key allowlist in page.tsx for now
-- since feed_tiers has no price_cents populated yet to threshold on.
update feed_tiers set
  subtitle = 'INSTITUTIONAL'
where tier_key = 'ld-ultra';

insert into schema_migrations (version, name) values
  ('0050', '0050_ld_ultra_institutional_badge.sql')
on conflict (version) do nothing;
