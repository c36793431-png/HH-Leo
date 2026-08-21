-- Rollback of 0048: "Add your strategy" moved off strategy_requests onto its own
-- strategy_submissions table (bus thread leo-strategies-add-your-strategy-2026-08-21,
-- marcus greenlit Plan B, coxwell confirmed). Zero real submissions existed at 0048's
-- shipping time (748c8b2, ~10 min prior to this decision), so this is a clean drop —
-- no data migration needed. strategy_requests goes back to serving only the
-- "Request a strategy" pitch flow it was originally built for.

alter table strategy_requests
  drop column if exists submission_type,
  drop column if exists strategy_name,
  drop column if exists category,
  drop column if exists instruments,
  drop column if exists feed_requirement,
  drop column if exists contact_preference;

insert into schema_migrations (version, name) values
  ('0052', '0052_strategy_requests_structured_rollback.sql')
on conflict (version) do nothing;
