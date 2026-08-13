-- Server registration + IP/geoIP tracking (marcus/coxwell, bus thread
-- horizon-portal-server-registration-2026-08-13). Three tables:
--   server_registrations — one user-declared row per license (form on feed signup,
--     editable later in /account/servers)
--   connection_ips        — capture log of actual source IPs seen on client-facing
--     calls (/v1/validate, /api/verify-license, future /v1/hb), last N per license
--   geoip_cache            — ip -> country/city/isp/org, 30d TTL via resolved_at

create table if not exists server_registrations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references licenses(id) on delete cascade,
  server_name text not null,
  vps_provider text not null,
  vps_provider_other text,
  server_location text not null,
  declared_ip text not null,
  -- Legit multi-VPS/failover users would otherwise trip the mismatch alert on every
  -- connection from their second box — this silences it per-account.
  multiple_ips_ok boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (license_id)
);

create table if not exists connection_ips (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references licenses(id) on delete cascade,
  ip text not null,
  captured_at timestamptz not null default now(),
  source text not null default 'validate'
);

create index if not exists connection_ips_license_captured_idx
  on connection_ips (license_id, captured_at desc);

create table if not exists geoip_cache (
  ip text primary key,
  country text,
  city text,
  isp text,
  org text,
  resolved_at timestamptz not null default now()
);

insert into schema_migrations (version, name) values
  ('0031', '0031_server_registration_ip_tracking.sql')
on conflict (version) do nothing;
