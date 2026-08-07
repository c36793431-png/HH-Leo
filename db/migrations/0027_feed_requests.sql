-- User-submitted "request a feed" intake for /feeds, replacing the mailto CTA with a proper
-- admin review queue. Free-text venue/use-case since users may not know exact terminology.
create table if not exists feed_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  venue_text text not null,
  use_case_text text not null,
  preferred_location text,
  status text not null default 'new' check (status in ('new', 'reviewing', 'declined', 'shipped')),
  admin_notes text,
  submitted_at timestamptz not null default now()
);

create index if not exists feed_requests_user_id_idx on feed_requests (user_id, submitted_at desc);
create index if not exists feed_requests_status_idx on feed_requests (status);

insert into schema_migrations (version, name) values
  ('0027', '0027_feed_requests.sql')
on conflict (version) do nothing;
