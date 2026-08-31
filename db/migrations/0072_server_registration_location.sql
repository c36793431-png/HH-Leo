-- Grouped multi-location /account/servers view (marcus, thread overnight-builds-2026-08-30).
-- Additive only: adds a fixed-vocabulary `location` alongside the existing free-text
-- `server_location`. Does NOT touch `unique(license_id)` -- one registration per license
-- is correct under license-per-server and stays that way; a prior design note said to
-- drop it and that note was wrong (marcus, same thread).
--
-- `server_location` keeps holding the human-readable label ("London", "New York", ...)
-- so every existing reader (admin/connections, notification templates) is unaffected.
-- `location` is the canonical grouping key, populated going forward by the fixed select
-- on /account/servers; legacy rows are left NULL and case-fold-canonicalized at read
-- time (see src/lib/server-locations.ts) rather than backfilled here.

alter table server_registrations
  add column if not exists location text;

alter table server_registrations
  add constraint server_registrations_location_check
  check (location is null or location in ('london', 'ny', 'cme', 'tokyo'));

insert into schema_migrations (version, name) values
  ('0072', '0072_server_registration_location.sql')
on conflict (version) do nothing;
