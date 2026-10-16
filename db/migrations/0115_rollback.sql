-- Rollback for 0115_feed_box_events.sql. Not applied automatically.
-- Roll the CODE back first: POST /api/feed-box/events and /admin/feed-health read this table and column. Dropping them
-- loses the stored events only; feed_boxes, 0101's status tables and the allowlist (0098) are untouched.
-- Order: feed_box_events references feed_boxes, so this must run BEFORE 0098_rollback.sql, and before
-- 0101_rollback.sql when both are unwound (newest first).
begin;
drop table if exists feed_box_events;
alter table feed_boxes drop column if exists events_ignored;
delete from schema_migrations where version = '0115';
commit;
