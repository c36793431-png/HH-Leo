-- Rollback for 0101_feed_status.sql. Not applied automatically.
-- Roll the CODE back first: POST /api/feed-box/status, /admin/feed-health and /admin/feed-boxes read these tables and
-- columns. Dropping them loses every box's status-tier set and its latest reported state (no history is kept, so
-- nothing else is lost); feed_boxes, feed_box_tiers and the allowlist (0098) are untouched.
-- Order: 0101's tables reference feed_boxes, so this must run BEFORE 0098_rollback.sql if both are ever unwound.
begin;
drop table if exists feed_status_latest;
drop table if exists feed_box_status_tiers;
alter table feed_boxes drop constraint if exists feed_boxes_status_collector_version_check;
alter table feed_boxes
  drop column if exists status_ignored,
  drop column if exists status_collector_version,
  drop column if exists status_measuring,
  drop column if exists status_sent_at,
  drop column if exists status_reported_at;
delete from schema_migrations where version = '0101';
commit;
