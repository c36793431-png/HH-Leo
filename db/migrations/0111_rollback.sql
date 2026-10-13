-- Rollback for 0111_license_hwid2.sql. Not applied automatically.
-- Roll the CODE back first: /v1/validate and the admin "Reset PC" action write these, and validate answers 500 without
-- them. Drops every hid2 binding and the last_hwid2/last_hwdegraded observations; export them first if the
-- enforcement-ON read still needs them. 0099's columns and rows are NOT touched.
begin;
alter table license_hwid_seen drop column if exists last_hwdegraded;
alter table license_hwid_seen drop column if exists last_hwid2;
alter table licenses drop column if exists hardware_id2_bound_at;
alter table licenses drop column if exists hardware_id2;
delete from schema_migrations where version = '0111';
commit;
