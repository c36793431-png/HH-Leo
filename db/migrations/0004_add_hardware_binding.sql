-- Wave BB.next: hardware-fingerprint binding for desktop client licenses.
-- Additive only — does not touch the existing status/expires_at contract that
-- /api/verify-license (frozen, see spec §API endpoints) already relies on.
alter table licenses add column if not exists hardware_id text;
alter table licenses add column if not exists tier text not null default 'full';
alter table licenses add column if not exists issued_by uuid references users(id);
alter table licenses add column if not exists activated_at timestamptz;

create index if not exists licenses_hardware_id_idx on licenses(hardware_id) where hardware_id is not null;

insert into schema_migrations (version, name) values
  ('0004', '0004_add_hardware_binding.sql')
on conflict (version) do nothing;
