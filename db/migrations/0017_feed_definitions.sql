-- Per-feed monthly cost, keyed by the same feed_type strings stored in
-- licenses.feed_types (see 0016). Table (not env var) so pricing stays
-- editable without a redeploy. Powers the admin dashboard Costs stat tile:
-- for each active license, sum monthly_cost_usd across its feed_types.
create table if not exists feed_definitions (
  feed_type text primary key,
  monthly_cost_usd numeric(10,2) not null
);

insert into feed_definitions (feed_type, monthly_cost_usd) values
  ('london', 15.00),
  ('ny', 15.00),
  ('crypto', 30.00),
  ('futures', 50.00)
on conflict (feed_type) do nothing;

insert into schema_migrations (version, name) values
  ('0017', '0017_feed_definitions.sql')
on conflict (version) do nothing;
