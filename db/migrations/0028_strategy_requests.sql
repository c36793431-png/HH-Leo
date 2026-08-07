-- User-submitted "request a strategy" queue for /strategies, mirrors feed_requests (see the
-- feed-requests migration). Admin surface at /admin/strategy-requests.
create table if not exists strategy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  idea_text text not null,
  asset_text text,
  timeframe_text text,
  references_text text,
  submitted_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'reviewing', 'declined', 'scoping', 'shipped')),
  admin_notes text
);

create index if not exists strategy_requests_status_idx on strategy_requests (status);
create index if not exists strategy_requests_submitted_at_idx on strategy_requests (submitted_at desc);

insert into schema_migrations (version, name) values
  ('0028', '0028_strategy_requests.sql')
on conflict (version) do nothing;
