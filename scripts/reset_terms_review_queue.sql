-- Teardown for scripts/seed_terms_review_queue.sql.
-- Bus thread provider-terms-negotiation-2026-08-24 (marcus): coxwell will click
-- Confirm and Decline on the seeded rows and then want to reset back to the
-- clean seeded state. This removes exactly what the seed inserted -- the same
-- 3 applications, picked with the identical deterministic selection -- and
-- nothing else. Safe to run repeatedly; run the seed again afterward to
-- restore the fixture.
--
-- Run manually with: psql "$NEON_DATABASE_URL" -f scripts/reset_terms_review_queue.sql
-- (or the project's usual one-off @neondatabase/serverless runner).

do $$
declare
  provider_a record;
  provider_b record;
  provider_c record;
begin
  select id into provider_a
  from provider_applications
  where user_id is not null
  order by applied_at
  limit 1;

  select id into provider_b
  from provider_applications
  where user_id is not null and id <> provider_a.id
  order by applied_at
  offset 1 limit 1;

  select id into provider_c
  from provider_applications
  where user_id is not null and id not in (provider_a.id, provider_b.id)
  order by applied_at
  offset 2 limit 1;

  delete from provider_tier_proposals
  where application_id in (provider_a.id, provider_b.id, provider_c.id);
end $$;
