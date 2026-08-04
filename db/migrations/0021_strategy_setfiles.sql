-- Setfiles library for the paid-tier sidebar shell (/setfiles + /admin/setfiles). Cards are
-- grouped client-side by strategy_key; sort_order controls position within a group. Seed rows
-- for the 5 launch strategies land in a follow-up migration once copy is finalized.
create table if not exists strategy_setfiles (
  id uuid primary key default gen_random_uuid(),
  sort_order int not null default 0,
  strategy_key text not null check (strategy_key in ('1leg', '2leg_lock', 'trend_impulse', 'obi', 'grid')),
  source text not null default 'example' check (source in ('verified', 'example')),
  name text not null,
  subtitle text not null,
  explanation text not null default '',
  params text not null default '',
  session_window text,
  warnings text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);

create index if not exists strategy_setfiles_strategy_key_idx on strategy_setfiles (strategy_key, sort_order);
create index if not exists strategy_setfiles_active_idx on strategy_setfiles (active);

insert into schema_migrations (version, name) values
  ('0021', '0021_strategy_setfiles.sql')
on conflict (version) do nothing;
