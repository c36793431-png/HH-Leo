-- Phase 2 of paid-user onboarding automation: DB-side tracking of paid-group
-- invite/join/removal lifecycle, so the portal (and the bus listener on the
-- axiom side) has a durable record independent of Telegram's own state.
create table if not exists group_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  telegram_id bigint not null,
  chat_id bigint not null default -1004469258486,
  invite_link text,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  removed_at timestamptz,
  status text not null default 'invited'
    check (status in ('invited', 'joined', 'left', 'removed_on_lapse'))
);

create index if not exists group_memberships_telegram_id_idx
  on group_memberships(telegram_id);

create index if not exists group_memberships_user_id_idx
  on group_memberships(user_id);

insert into schema_migrations (version, name) values
  ('0009', '0009_group_memberships.sql')
on conflict (version) do nothing;
