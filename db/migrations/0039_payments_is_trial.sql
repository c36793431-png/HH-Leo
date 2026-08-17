-- Distinguish trial-tier auto-payment rows from genuine paid revenue (bus thread
-- leo-finance-trial-vs-paid-ledger-fix-2026-08-15, coxwell's call: option B —
-- flag + exclude from Gross Received, keep the row visible in the full ledger
-- so the audit trail survives license tier reclassification after issuance).
alter table payments add column if not exists is_trial boolean not null default false;

insert into schema_migrations (version, name) values
  ('0039', '0039_payments_is_trial.sql')
on conflict (version) do nothing;
