-- Rollback for 0095_agent_grants.sql. Not applied automatically.
-- Roll the code back first: /api/agent/trial and /api/agent/feed read and write this table and
-- fail without it.
-- Drops the ledger only. The grants it records are ordinary licences and feed subscriptions, each
-- with its own admin_actions row (via 'agent-api' + the idempotency key), and stay as they are.
-- Once the table is gone a same-key retry is no longer recognised, so leave the routes off
-- (WAF deny rule) until it is back.
begin;
drop table if exists agent_grants;
delete from schema_migrations where version = '0095';
commit;
