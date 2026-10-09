-- Rollback for 0098_feed_autoprovision.sql. Not applied automatically.
-- Roll the CODE back first: the allowlist/applied endpoints, the admin Feed boxes page and the expiry job read
-- these tables and columns. Dropping the columns loses every box write-back (applied_at/by, result, reason), the
-- expiry job's revoked_by and lapse_seen_at, and the record ids the box holds in its state file; revoked_at
-- itself (0086) is kept. Export the write-back first if anyone still needs it.
begin;
alter table feed_allowlist_records drop constraint if exists feed_allowlist_records_apply_reason_check;
alter table feed_allowlist_records drop constraint if exists feed_allowlist_records_applied_by_check;
alter table feed_allowlist_records drop constraint if exists feed_allowlist_records_apply_result_check;
alter table feed_allowlist_records drop constraint if exists feed_allowlist_records_id_key;
alter table feed_allowlist_records
  drop column if exists lapse_seen_at,
  drop column if exists revoked_by,
  drop column if exists apply_reason,
  drop column if exists apply_result,
  drop column if exists applied_by,
  drop column if exists applied_at,
  drop column if exists id;
drop table if exists feed_box_tiers;
drop table if exists feed_boxes;
delete from schema_migrations where version = '0098';
commit;
