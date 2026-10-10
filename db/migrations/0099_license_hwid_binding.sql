-- One licence, one PC: PHASE 1, observe-only (coxwell GO 2026-10-09 ~23:15Z via marcus m63368; plan m63391 + m63392
-- + delta m63418; rulings m63383/m63396/m63419/m63422; Fable's review m63552 PASS WITH STRIKES; build GO m63554).
--
-- /v1/validate binds a live licence to the first clean hardwareid it sees (licenses.hardware_id, 0004) and records
-- every (licence, hwid) pair it is asked about here. Refusal is behind HWID_ENFORCE, which is OFF at ship: until it is
-- set, every key gets its real status whatever PC it is on. This table is what the observe-only window is read from
-- before anyone turns refusal on.
--
-- licenses.hardware_bound_at: when the CURRENT binding was set. The admin "Reset PC" clears it with hardware_id;
--   activated_at (0004) keeps the first activation ever and is never cleared.
-- license_hwid_seen: one row per (licence, hwid) that validated while the licence was active, the BOUND hwid included
--   (Fable S1: a table of losers only cannot tell a degraded first-seen hash from the real PC). licenses.hardware_id
--   marks which row is bound. hits counts validates, not startups: the client re-sends its startup value every 30 min.
--   last_version is the client's currentversion, last_ip the caller's first x-forwarded-for hop. 'HWID-ERROR-<name>'
--   values (the client's WMI total failure) are recorded here but never bind.
--   Same bounded grain as client_heartbeats (0085). Expired, revoked and unknown keys write nothing.
--   FK with cascade: nothing in src deletes a licence, and a hand delete must not be blocked by its observations.
-- Additive only. Apply BEFORE the code merges: validate writes both and answers 500 if either is missing.
-- Rollback: 0099_rollback.sql.
alter table licenses add column if not exists hardware_bound_at timestamptz;

create table if not exists license_hwid_seen (
  license_id uuid not null references licenses(id) on delete cascade,
  hwid text not null check (length(hwid) between 1 and 256),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  hits bigint not null default 1,
  last_version text,
  last_ip text,
  primary key (license_id, hwid)
);

-- The observe-only read: "every licence's PCs, most recently seen first".
create index if not exists license_hwid_seen_last_seen_idx on license_hwid_seen (last_seen desc);

insert into schema_migrations (version, name) values
  ('0099', '0099_license_hwid_binding.sql')
on conflict (version) do nothing;
