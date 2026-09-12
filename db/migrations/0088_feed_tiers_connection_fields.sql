-- NOT APPLIED -- do not run against prod. Applying this is marcus's step, after coxwell's word
-- (m49036 sequence (b)); the UI that reads these columns must not merge to main before that, since
-- a read of columns that do not exist would 500 the provider Feeds tab.
--
-- Bus thread leo-provider-feeds-edit-connection-2026-09-12, marcus m49036, from coxwell 21:18Z:
-- the provider must be able to edit each feed's connection details -- host, port, FIX protocol --
-- and those details must show on the LD Base and NY Base bundles on /feed/dashboard/feeds.
--
-- WHY A SCHEMA ADD AND NOT A JOIN. The five assigned tiers on that tab are feed_tiers rows (the
-- house catalogue), and feed_tiers carries no connection columns at all. Verified two ways rather
-- than taken from the dispatch: the migrations directory (feed_tiers is created in 0058 and no
-- later file adds any of these four), and information_schema.columns against prod at 2026-09-12
-- 23:2xZ, which returns zero rows for feed_tiers x (protocol, endpoint_host, endpoint_port,
-- compid). provider_tiers HAS all four, but those are the third-party self-serve tiers -- a
-- different table describing different products, and joining one to the other would invent a
-- relationship the schema does not record.
--
-- 0087 IS THE NEXT FREE NUMBER, confirmed both ways as m49036 asked: the migrations directory tops
-- out at 0086_marketplace_recut.sql, and schema_migrations in prod tops out at '0086'.
--
-- NAMES AND TYPES MIRROR provider_tiers EXACTLY so a later reconciliation of the two catalogues is
-- a rename and not a mapping (m49036 item 1). Read from the live catalogue, not from the migration
-- text: provider_tiers.protocol, .endpoint_host, .endpoint_port, .compid are all `text` and all
-- nullable -- endpoint_host/endpoint_port from 0060 (table creation), protocol/compid from 0083.
-- Port is text there, so it is text here; validation belongs in the write path, and a numeric
-- column on one side of a future rename would be the mapping this is meant to avoid.
--
-- ALL FOUR NULLABLE, NO DEFAULTS, NO BACKFILL. Every existing feed_tiers row predates the column
-- set and there is no correct value to invent for it; the UI renders an unset field as "Not set",
-- which is honest, rather than a dash or an empty string pretending to be a value. Nor is there
-- anywhere to backfill FROM: provider_tiers and provider_tier_proposals both have zero rows, and
-- the only two provider_applications rows have protocol null -- so no protocol value exists
-- anywhere in prod today (read 2026-09-12 23:2xZ).
--
-- host+port without protocol is not a connectable endpoint, so all four columns go in one
-- migration rather than a partial add -- the same all-or-nothing read 0083 was built on.
--
-- Companion rollback: 0087_rollback.sql. Not applied automatically by this file.

alter table feed_tiers
  add column if not exists protocol text,
  add column if not exists endpoint_host text,
  add column if not exists endpoint_port text,
  add column if not exists compid text;

insert into schema_migrations (version, name) values
  ('0087', '0087_feed_tiers_connection_fields.sql')
on conflict (version) do nothing;
