-- Rollback for 0102_feed_tier_connections.sql. Not applied automatically.
-- Roll the CODE back first: /admin/feed-connections and the client-login field on /admin/users/[id] read these tables.
-- Dropping them loses every tier's connection details and every client's username (no copy is kept elsewhere);
-- feed_tiers, feed_subscriptions and the allowlist are untouched.
begin;
drop table if exists feed_client_logins;
drop table if exists feed_tier_connections;
delete from schema_migrations where version = '0102';
commit;
