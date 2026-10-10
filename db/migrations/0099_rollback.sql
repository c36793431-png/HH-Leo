-- Rollback for 0099_license_hwid_binding.sql. Not applied automatically.
-- Roll the CODE back first: /v1/validate and the admin "Reset PC" action write these, and validate answers 500 without
-- them. Drops every recorded (licence, hwid) observation and every binding timestamp; export license_hwid_seen first if
-- the observe-only read still needs it. licenses.hardware_id and activated_at (0004) are NOT touched, so bindings
-- already made stay on the licence rows; clear them separately if the lock itself is being abandoned.
begin;
drop table if exists license_hwid_seen;
alter table licenses drop column if exists hardware_bound_at;
delete from schema_migrations where version = '0099';
commit;
