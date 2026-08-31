-- Rename London tier display names to the short form already used by
-- Telegram/email/admin copy and the compare/leaderboard view (coxwell via
-- marcus, bus thread multi-license-visibility-2026-08-31, "tier name shorten").
-- LD Alpha 85 -> Alpha, LD Ultra -> Ultra. Same kind of rename 0049 already
-- did for NY (ny-fast -> 'NY Alpha', ny-normal -> 'NY Beta'); London was
-- simply missed. tier_key values and card subtitles are unchanged.
-- Ship src/lib/feed-tier-catalogue.ts's matching rename only after this is
-- confirmed applied -- holding it avoids a window where Telegram/email/admin
-- say "Alpha"/"Ultra" while the tiers page still says "LD Alpha 85"/"LD Ultra".

update feed_tiers set name = 'Alpha' where region_key = 'london' and tier_key = 'ld-alpha-85';
update feed_tiers set name = 'Ultra' where region_key = 'london' and tier_key = 'ld-ultra';

insert into schema_migrations (version, name) values
  ('0074', '0074_ld_tier_names_short_form.sql')
on conflict (version) do nothing;
