-- Structured feed-tier signup requests (marcus/coxwell, bus thread
-- horizon-portal-v2051-polish-2026-08-13, "Feed Request backend" add-on). Distinct from
-- feed_requests (0027, free-text "ask for a venue we don't have" intake) -- this is a
-- paid user picking a specific region+tier on a feed we already operate and requesting
-- provisioning against their registered server.
create table if not exists feed_tier_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  license_id uuid not null references licenses(id) on delete cascade,
  region text not null check (region in ('london', 'ny', 'cme', 'tokyo')),
  tier_key text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'provisioned')),
  reason text,
  created_at timestamptz not null default now(),
  actioned_at timestamptz,
  actioned_by uuid references users(id)
);

create index if not exists feed_tier_requests_user_id_idx on feed_tier_requests (user_id, created_at desc);
create index if not exists feed_tier_requests_status_idx on feed_tier_requests (status, created_at desc);

insert into schema_migrations (version, name) values
  ('0034', '0034_feed_tier_requests.sql')
on conflict (version) do nothing;
