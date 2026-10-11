-- Client connection details per feed tier (B3-2: coxwell via marcus m64680, plan m64756-9, rulings m64767/m64808,
-- Fable design pass m64804 S1 + N1). What a client with live access needs to connect: the connection type, host,
-- port, the symbol list, the data type and the session hours, edited from /admin/feed-connections. Never a password:
-- no column for one exists here, and a shared FIX password is sent to the client separately.
--
-- feed_tier_connections: one row per (tier, connection type). One CME tier carries two (FOC13's agent opens every
--   served IP on both ports, m63828): b_fix (:5031) and ctrader_fix (:5101). symbols is a JSON array of
--   {symbol, description}; the element shape is checked by the server action (Fable N1), the DB holds array + length.
-- feed_client_logins: the per-client username for one connection type of a tier (e.g. 'C58-ROBERT' on b_fix), keyed
--   per client, not per subscription row, so a renewal keeps it (Fable S1: per connection type, since nothing says the
--   cTrader FIX SenderCompID is the B FIX name). Unique per (tier, connection type): no two clients share a name.
-- Additive only. Rollback: 0102_rollback.sql.
create table if not exists feed_tier_connections (
  feed_tier_id uuid not null references feed_tiers(id),
  conn_type text not null check (conn_type in ('ctrader_fix', 'b_fix', 'horizon_direct')),
  host text not null check (host ~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$'),
  port integer not null check (port between 1 and 65535),
  data_type text check (data_type is null or length(data_type) between 1 and 120),
  session_hours text check (session_hours is null or length(session_hours) between 1 and 200),
  symbols jsonb not null default '[]'::jsonb
    check (jsonb_typeof(symbols) = 'array' and jsonb_array_length(symbols) <= 64),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  primary key (feed_tier_id, conn_type)
);

create table if not exists feed_client_logins (
  subscriber_user_id uuid not null references users(id),
  feed_tier_id uuid not null,
  conn_type text not null,
  username text not null check (username ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{1,31}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  primary key (subscriber_user_id, feed_tier_id, conn_type),
  foreign key (feed_tier_id, conn_type) references feed_tier_connections (feed_tier_id, conn_type),
  constraint feed_client_logins_username_key unique (feed_tier_id, conn_type, username)
);

insert into schema_migrations (version, name) values
  ('0102', '0102_feed_tier_connections.sql')
on conflict (version) do nothing;
