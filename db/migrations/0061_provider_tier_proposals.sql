-- provider_tier_proposals: append-only negotiation rounds for provider_tiers.
-- Bus thread provider-terms-negotiation-2026-08-24 (marcus m29228, coxwell money-model
-- answer "Provider puts a %, Fee and then i approve it for now").
--
-- provider_tiers stays confirmed-only by construction (no status column there, per
-- marcus's 2026-08-24 correction) -- every draft/proposed/declined state lives here
-- instead. One row per round, never updated in place; the current state of a
-- negotiation is "the latest row for this application_id ordered by created_at".
--
-- declined_note is built as a single column regardless of the still-open
-- admin-only-vs-provider-visible question -- if that splits later it's one added
-- nullable column, not a reshape.
create table provider_tier_proposals (
  id                 uuid primary key default gen_random_uuid(),
  application_id     uuid not null references provider_applications(id),
  provider_user_id   uuid not null references users(id),
  tier_name          text not null,
  client_price_cents integer not null,
  provider_split_pct integer not null,
  trial_length_days  integer not null default 14,
  protocol           text,
  endpoint_host      text,
  endpoint_port      text,
  compid             text,
  regions            text[],
  coverage           text[],
  terms_status       text not null default 'pending',
  declined_note      text,
  decided_by         uuid references users(id),
  decided_at         timestamptz,
  created_at         timestamptz not null default now()
);

create index provider_tier_proposals_application_idx on provider_tier_proposals (application_id);
create index provider_tier_proposals_provider_idx on provider_tier_proposals (provider_user_id);

alter table provider_tiers add column if not exists trial_length_days integer not null default 14;
alter table provider_tiers add column if not exists confirmed_at timestamptz;

insert into schema_migrations (version, name) values
  ('0061', '0061_provider_tier_proposals.sql')
on conflict (version) do nothing;
