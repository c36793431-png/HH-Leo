-- Black feed trial requests (marcus/coxwell, bus thread leo-portal-updates-bundle-2026-08-17,
-- 4 answered design questions on m21921b). Paid-only, self-service, one-per-desk: a license
-- can only ever hold one trial row, enforced via unique(license_id) the same way
-- server_registrations already enforces one server per license.
create table if not exists black_trials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  license_id uuid not null references licenses(id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'active', 'declined', 'converted')),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  expires_at timestamptz,
  endpoint text,
  credentials text,
  reason text,
  actioned_by uuid references users(id),
  unique (license_id)
);

create index if not exists black_trials_status_idx on black_trials (status, requested_at desc);

insert into schema_migrations (version, name) values
  ('0041', '0041_black_trials.sql')
on conflict (version) do nothing;
