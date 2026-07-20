-- Horizon HFT Portal — initial schema
-- Auth.js core tables (Email provider requires a DB adapter for verification tokens)

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  "emailVerified" timestamptz,
  telegram_user_id bigint unique,
  telegram_username text,
  display_name text,
  image text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references users(id) on delete cascade,
  type text not null,
  provider text not null,
  "providerAccountId" text not null,
  refresh_token text,
  access_token text,
  expires_at bigint,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  unique(provider, "providerAccountId")
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  "sessionToken" text not null unique,
  "userId" uuid not null references users(id) on delete cascade,
  expires timestamptz not null
);

create table if not exists verification_token (
  identifier text not null,
  token text not null,
  expires timestamptz not null,
  primary key (identifier, token)
);

-- Portal domain tables

create table if not exists licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  claim_email text,
  claim_telegram_user_id bigint,
  license_key text not null unique,
  status text not null default 'active' check (status in ('active', 'revoked')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_verified_at timestamptz,
  lifecycle_state text,
  notes text
);

create index if not exists licenses_user_id_idx on licenses(user_id);
create index if not exists licenses_claim_email_idx on licenses(claim_email) where user_id is null;
create index if not exists licenses_claim_telegram_idx on licenses(claim_telegram_user_id) where user_id is null;

create table if not exists portal_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references users(id),
  action_type text not null,
  target_user_id uuid references users(id),
  details_json jsonb,
  created_at timestamptz not null default now()
);
