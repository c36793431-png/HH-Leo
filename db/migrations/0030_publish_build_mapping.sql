-- CI auto-publish endpoint (bus thread horizon-portal-upload-endpoint-2026-08-13):
-- Actions ships the obfuscar mapping.txt alongside each build for indefinite
-- retention (Actions artifact retention defaults to 90 days; crash-report
-- deobfuscation on old builds needs it years later). Extend downloads
-- additively rather than a new table, same approach as 0005/0018.
alter table downloads add column if not exists mapping_blob_url text;
alter table downloads add column if not exists mapping_blob_pathname text;
alter table downloads add column if not exists source text not null default 'manual'
  check (source in ('manual', 'ci'));

-- Idempotency: publishing an already-shipped version+platform must fail loudly
-- rather than silently overwrite. Partial unique index (soft-deletes excluded)
-- backs an ON CONFLICT-free existence check plus a DB-level guarantee against
-- concurrent publish races.
create unique index if not exists downloads_version_platform_live_uidx
  on downloads(version, platform) where deleted_at is null;

insert into schema_migrations (version, name) values
  ('0030', '0030_publish_build_mapping.sql')
on conflict (version) do nothing;
