-- terms_status vocabulary lock: proposed -> confirmed | declined. Three values.
-- Marcus's ruling (bus thread provider-terms-negotiation-2026-08-24, m29343):
-- the column is plain text with no check constraint today, so nothing enforces
-- it and the value can drift silently. Fixing it now costs nothing since zero
-- code reads or writes terms_status yet; later it's a data migration.
--
-- Four decisions from the ruling:
--   1. Terminal value is `declined` (matches declined_note; spec's `rejected` is stale).
--   2. Entry value is `proposed`, not `pending` -- names what the row is.
--   3. `under_review` is dropped -- nothing anywhere transitions into it (see
--      spec's admin review flow: coxwell opens the card and either confirms or
--      declines, no intermediate state is ever set).
--   4. Add the check constraint so the wrong value is impossible, not just unlikely.
alter table provider_tier_proposals alter column terms_status set default 'proposed';

update provider_tier_proposals set terms_status = 'proposed' where terms_status = 'pending';

alter table provider_tier_proposals
  add constraint provider_tier_proposals_terms_status_check
  check (terms_status in ('proposed', 'confirmed', 'declined'));

insert into schema_migrations (version, name) values
  ('0064', '0064_provider_tier_proposal_terms_status_constraint.sql')
on conflict (version) do nothing;
