-- Replace payments.is_trial with activation_source enum (bus thread
-- leo-finance-trial-vs-paid-ledger-fix-2026-08-15, marcus's correction confirmed by
-- coxwell 2026-08-16): a boolean can't tell trial from deal, and coxwell flagged a
-- deal-tier row (chfo@keemail.me) mis-tagged as trial under the old flag.
alter table payments add column if not exists activation_source text
  not null default 'paid'
  check (activation_source in ('paid', 'trial', 'deal', 'team'));

update payments set activation_source = 'trial' where is_trial and activation_source = 'paid';

-- Correct the 4 ghost rows to their verified intended values (see
-- HANDOFF_finance_activation_source_correction_2026-08-16.md for the id/tier table).
update payments set activation_source = 'trial' where id in (
  '23b6054f-57b6-4005-95ed-e36615632ac2',
  '0ed4d985-1754-4d54-b5ed-8a96ebcfa947',
  '0c101525-b9ed-48b0-857e-6ae8cce226c5'
);
update payments set activation_source = 'deal' where id = '79f3f4d7-e3e4-4ff6-9cca-9ba536db192e';

alter table payments drop column if exists is_trial;

insert into schema_migrations (version, name) values
  ('0040', '0040_payments_activation_source.sql')
on conflict (version) do nothing;
