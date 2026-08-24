-- Adds the provider-visible decline reason, splitting it from the admin-private
-- declined_note per coxwell's ruling (relayed by marcus, bus thread
-- provider-terms-negotiation-2026-08-24): declined_note stays admin-only/never
-- rendered or emailed; decline_reason_public is the one-line in-app copy the
-- provider sees, nullable because the conversation sometimes happens on Telegram
-- instead.
alter table provider_tier_proposals add column if not exists decline_reason_public text;

insert into schema_migrations (version, name) values
  ('0062', '0062_provider_tier_proposal_public_decline_reason.sql')
on conflict (version) do nothing;
