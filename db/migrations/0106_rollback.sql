-- Rollback for 0106_downloads_draft_publish.sql. Not applied automatically.
-- HAZARD (a draft becomes a customer-visible release): the code before 0106 has no published_at gate,
-- so the moment that code serves, every draft row is live on /downloads, the dashboard and
-- /api/download/<version>. Before rolling the CODE back, Delete or Publish every draft in
-- /admin/downloads. This file refuses while any draft exists, for the same reason.
-- Roll the code back first: the 0106 code selects published_at and mapping_sha256.
-- Dropping mapping_sha256/mapping_size_bytes loses the server's record of each map's hash; the map
-- blobs themselves stay in Blob storage.
begin;
do $$
begin
  if exists (select 1 from downloads where deleted_at is null and published_at is null) then
    raise exception '0106 rollback: downloads has draft rows; Delete or Publish them first';
  end if;
end $$;
drop index if exists downloads_platform_published_idx;
alter table downloads drop constraint if exists downloads_mapping_sha256_hex;
alter table downloads drop column if exists mapping_size_bytes;
alter table downloads drop column if exists mapping_sha256;
alter table downloads drop column if exists published_by;
alter table downloads drop column if exists published_at;
delete from schema_migrations where version = '0106';
commit;
