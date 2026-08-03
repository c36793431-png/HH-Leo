-- User Config Summary — consent-first, dual-attribution record of a trader's live
-- setup (broker, feed, strategy, params). One current row per user in
-- user_config_summaries; every save also appends to user_config_summary_history so
-- the timeline is preserved for the future aggregate/R&D view. Never populated by
-- client-side telemetry — only admin-entry or user self-entry writes these tables.
create table if not exists user_config_summaries (
  user_id uuid primary key references users(id) on delete cascade,
  broker text,
  account_type text,
  commission_pts_round_trip integer,
  fast_feed_provider text,
  symbols text[] not null default '{}',
  strategy text check (strategy in ('1 Leg', '2 Leg Lock', 'Trend Impulse', 'OBI', 'Grid')),
  config_json jsonb not null default '{}'::jsonb,
  notes text,
  source text not null check (source in ('self_reported', 'admin_verified')),
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists user_config_summary_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  broker text,
  account_type text,
  commission_pts_round_trip integer,
  fast_feed_provider text,
  symbols text[] not null default '{}',
  strategy text,
  config_json jsonb not null default '{}'::jsonb,
  notes text,
  source text not null,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists user_config_summary_history_user_id_idx
  on user_config_summary_history (user_id, updated_at desc);

insert into schema_migrations (version, name) values
  ('0019', '0019_user_config_summary.sql')
on conflict (version) do nothing;
