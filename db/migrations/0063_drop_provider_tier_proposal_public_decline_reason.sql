-- Reverts 0062. marcus's m29258 ruling (private note + optional provider-facing
-- reason) was reversed in m29265 after Iris argued a private field sitting next
-- to a rendered one is a discipline dependency that leaks the first time it's
-- pasted fast; the dead-end is solved by generic-notice-plus-prefilled-draft
-- instead. specs/admin-terms-review.md is stamped FINAL with one field only, so
-- decline_reason_public is a column for a design that was rejected -- drop it
-- before anything reads it, per bus thread provider-terms-negotiation-2026-08-24.
alter table provider_tier_proposals drop column if exists decline_reason_public;

insert into schema_migrations (version, name) values
  ('0063', '0063_drop_provider_tier_proposal_public_decline_reason.sql')
on conflict (version) do nothing;
