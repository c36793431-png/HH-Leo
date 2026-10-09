-- Rollback for 0097_client_reach.sql. Not applied automatically.
-- Roll the code back first: notify.ts, client-reach.ts, the dashboard banner/quick-pick, the admin contact
-- block and the stale-request cron read and write these columns and tables and fail without them.
-- Drops the unreachable-alert and notice history and the welcome answers; the grants themselves (licences,
-- feed subscriptions, basket request status) are untouched.
begin;
drop table if exists client_notices;
drop table if exists client_unreachable_alerts;
alter table basket_requests drop column if exists reminded_at;
alter table users
  drop column if exists onboarding_goal_at,
  drop column if exists onboarding_goal,
  drop column if exists tg_last_dm_error,
  drop column if exists tg_last_dm_ok,
  drop column if exists tg_last_dm_at;
delete from schema_migrations where version = '0097';
commit;
