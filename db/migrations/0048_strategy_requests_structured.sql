-- "Add your strategy" v1 (bus thread leo-strategies-add-your-strategy-2026-08-21, marcus
-- greenlit, coxwell confirmed). Extends strategy_requests with nullable structured-submission
-- columns rather than a new table, discriminated by submission_type ('pitch' = existing free-text
-- "Request a strategy" flow, 'structured' = new "Add your strategy" form). idea_text stays
-- not-null and is reused to hold the structured form's required Description field.

alter table strategy_requests
  add column if not exists submission_type text not null default 'pitch'
    check (submission_type in ('pitch', 'structured')),
  add column if not exists strategy_name text,
  add column if not exists category text
    check (category is null or category in ('arbitrage', 'momentum', 'grid', 'scalping', 'custom')),
  add column if not exists instruments text[],
  add column if not exists feed_requirement text
    check (feed_requirement is null or feed_requirement in ('london', 'ny', 'cme', 'tokyo')),
  add column if not exists contact_preference text
    check (contact_preference is null or contact_preference in ('portal', 'telegram', 'email'));

insert into schema_migrations (version, name) values
  ('0048', '0048_strategy_requests_structured.sql')
on conflict (version) do nothing;
