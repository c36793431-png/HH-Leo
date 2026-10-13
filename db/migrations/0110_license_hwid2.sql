-- One licence, one PC: the second identity (2.0.9 B2, HWID wire contract v1 as amended by Fable's verdict m67568/m67569:
-- S2 binding model, S3 fallback never refused, C1-C5). Builds on 0099; enforcement is still HWID_ENFORCE, OFF.
--
-- licenses.hardware_id2: the ONE bound hid2 (SHA-256('hid2|MachineGuid|SMBIOS UUID')[:32], uppercase hex, sent by
--   2.0.9+ as hardwareid2). Set once by /v1/validate in the same statement as hardware_id, and only while the licence
--   has no bound hid or the request's hid IS the bound one (Fable S2): a sharer's PC never binds it. Cleared with
--   hardware_id by the admin "Reset PC". Not a set: one hid2 per licence, like hardware_id.
-- licenses.hardware_id2_bound_at: when the current hid2 binding was set; cleared with it.
-- license_hwid_seen.last_hwid2 / last_hwdegraded (Fable C4): what the latest validate from this (licence, hwid) carried,
--   NULL = the key was absent or failed its shape check. This is the data for the separate enforcement-ON decision
--   (how many live licences show hwdegraded / no hid2). hits/last_seen are unchanged from 0099.
-- Additive only. Apply BEFORE the code merges: validate writes all four and answers 500 if one is missing.
-- Rollback: 0110_rollback.sql.
alter table licenses add column if not exists hardware_id2 text check (hardware_id2 ~ '^[0-9A-F]{32}$');
alter table licenses add column if not exists hardware_id2_bound_at timestamptz;

alter table license_hwid_seen add column if not exists last_hwid2 text check (last_hwid2 ~ '^[0-9A-F]{32}$');
alter table license_hwid_seen add column if not exists last_hwdegraded text check (length(last_hwdegraded) between 1 and 32);

insert into schema_migrations (version, name) values
  ('0110', '0110_license_hwid2.sql')
on conflict (version) do nothing;
