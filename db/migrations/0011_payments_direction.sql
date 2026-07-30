-- Payments ledger needs both directions, not just receipts: client pays 100,
-- we pay 15 to the feed provider (bus thread
-- horizon-portal-admin-dashboard-2026-07-30, coxwell's economics). source_type
-- is renamed category since it now also covers costs (feed_provider, infra).
alter table payments rename column source_type to category;
alter table payments drop constraint payments_source_type_check;
alter table payments add constraint payments_category_check
  check (category in ('customer', 'partner', 'affiliate', 'feed_provider', 'infra', 'other'));

alter table payments add column direction text check (direction in ('in', 'out'));
update payments set direction = 'in' where direction is null;
alter table payments alter column direction set not null;

insert into schema_migrations (version, name) values
  ('0011', '0011_payments_direction.sql')
on conflict (version) do nothing;
