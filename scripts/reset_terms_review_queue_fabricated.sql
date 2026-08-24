-- Teardown for scripts/seed_terms_review_queue_fabricated.sql.
-- Bus thread provider-terms-negotiation-2026-08-24 (marcus): matched on the "[TEST] "
-- name prefix, not a time window or a row count, so this stays exact even if the
-- fabricated fixture is re-seeded and re-torn-down multiple times, or real
-- provider_applications rows land in prod alongside it later.
--
-- Run manually with: psql "$NEON_DATABASE_URL" -f scripts/reset_terms_review_queue_fabricated.sql

do $$
declare
  test_app_ids uuid[];
  test_user_ids uuid[];
begin
  select array_agg(id) into test_app_ids
  from provider_applications
  where name like '[TEST] %';

  if test_app_ids is null then
    return;
  end if;

  select array_agg(user_id) into test_user_ids
  from provider_applications
  where id = any(test_app_ids) and user_id is not null;

  delete from provider_tier_proposals where application_id = any(test_app_ids);
  delete from provider_applications where id = any(test_app_ids);
  delete from users where id = any(test_user_ids) and display_name like '[TEST] %';
end $$;
