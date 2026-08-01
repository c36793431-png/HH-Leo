-- Per-user feed entitlements. Feeds are admin-granted add-ons attached to a paid
-- license (co-terminal with it — extend license -> feeds extend, revoke -> feeds gone).
-- text[] rather than an enum column/table so new feed types (beyond the initial
-- futures/london/ny/crypto set) can be added later without a schema change.
alter table licenses add column feed_types text[] not null default '{}';

insert into schema_migrations (version, name) values
  ('0016', '0016_license_feed_types.sql')
on conflict (version) do nothing;
