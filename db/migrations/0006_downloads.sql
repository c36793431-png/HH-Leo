-- Windows/macOS installer downloads, versioned + platform-scoped, replacing the
-- single-slot portal_config('installer') key with real history.
create table if not exists downloads (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  platform text not null check (platform in ('windows', 'macos')),
  blob_url text not null,
  blob_pathname text not null,
  sha256 text not null,
  size_bytes bigint not null,
  changelog text,
  uploaded_by uuid references users(id),
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists downloads_platform_uploaded_idx
  on downloads(platform, uploaded_at desc) where deleted_at is null;
create index if not exists downloads_version_platform_idx
  on downloads(version, platform) where deleted_at is null;

insert into schema_migrations (version, name) values
  ('0006', '0006_downloads.sql')
on conflict (version) do nothing;
