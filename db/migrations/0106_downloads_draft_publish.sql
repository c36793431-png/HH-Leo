-- Agent release upload (plan m66654 + mapping delta m66679; Fable PASS WITH STRIKES m66680; build GO
-- marcus m66684). A CI/agent upload lands as a DRAFT that customers can't see; an admin publishes it.
--   published_at: NULL = draft. Every customer reader gates on it (src/lib/downloads.ts); "latest" orders
--     by it. No default: an insert that forgets it lands as a draft (fails closed). The manual admin
--     path sets it at insert; /api/admin/publish-build/confirm always writes NULL.
--   published_by: the admin who published (admin session only; there is no publish token). NULL on a
--     draft and after unpublish; the admin_actions rows keep the history.
--   mapping_sha256 / mapping_size_bytes: the server's own hash and size of the obfuscar Mapping.txt,
--     read back privately at confirm. No customer reader selects mapping_* (downloads-draft.test.ts).
-- Backfill: every row that exists before this migration went live at insert (the old code had no
-- draft state), so published_at = uploaded_at and published_by = uploaded_by, deleted rows included.
-- The backfill runs only in the same statement block that adds the column, so re-running this file
-- can never publish a real draft.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'downloads' and column_name = 'published_at'
  ) then
    alter table downloads add column published_at timestamptz;
    alter table downloads add column published_by uuid references users(id);
    update downloads set published_at = uploaded_at, published_by = uploaded_by;
  end if;
end $$;

alter table downloads add column if not exists mapping_sha256 text;
alter table downloads add column if not exists mapping_size_bytes bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'downloads_mapping_sha256_hex') then
    alter table downloads add constraint downloads_mapping_sha256_hex
      check (mapping_sha256 is null or mapping_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end $$;

-- getLatestDownloads: newest PUBLISHED row per platform (Fable (c)).
create index if not exists downloads_platform_published_idx
  on downloads(platform, published_at desc) where deleted_at is null and published_at is not null;

insert into schema_migrations (version, name) values
  ('0106', '0106_downloads_draft_publish.sql')
on conflict (version) do nothing;
