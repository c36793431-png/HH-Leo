-- FABRICATED variant of scripts/seed_terms_review_queue.sql.
-- Bus thread provider-terms-negotiation-2026-08-24 (marcus ruling on the seed blocker):
-- prod has zero provider_applications -- the real onboarding funnel has never been used
-- by anyone -- so the non-fabricating seed script aborts loudly and cannot demo the
-- terms-review queue for coxwell. Marcus authorised fabrication for this smoke test only,
-- with hard constraints. This script is the explicit opt-in: it is a SEPARATE file from
-- scripts/seed_terms_review_queue.sql, which keeps its never-fabricate guard untouched.
-- Only run this one if you mean to.
--
-- Constraints (marcus, provider-terms-negotiation-2026-08-24):
-- 1. Names self-evidently synthetic -- every fabricated row is prefixed "[TEST] " so
--    coxwell never wonders whether a lead on /admin/providers is real.
-- 2. Emails structurally undeliverable -- .invalid / .test TLDs (RFC 2606, guaranteed
--    non-resolving), closing the decline-email question by construction regardless of
--    whether the send path is live.
-- 3. Teardown (reset_terms_review_queue_fabricated.sql) removes exactly these rows,
--    matched on the "[TEST] " prefix -- not a time window, not a row count.
-- 4. Guard: aborts if provider_applications already has ANY non-"[TEST]"-prefixed row --
--    this script is for an empty book only, never to be run once real applications exist.
--
-- Run manually with: psql "$NEON_DATABASE_URL" -f scripts/seed_terms_review_queue_fabricated.sql
-- Same 3-scenario spec as the real seed (single first proposal / decline-then-resubmit /
-- two-tiers-in-flight) -- see that file's header for what each scenario exercises.

do $$
declare
  real_rows int;
  user_a uuid;
  user_b uuid;
  user_c uuid;
  app_a uuid;
  app_b uuid;
  app_c uuid;
  admin_user_id uuid;
begin
  select count(*) into real_rows
  from provider_applications
  where name not like '[TEST] %';

  if real_rows > 0 then
    raise exception 'seed_terms_review_queue_fabricated: % real (non-[TEST]) provider_applications rows exist -- this fabrication script is for an empty book only, refusing to run', real_rows;
  end if;

  insert into users (email, display_name, role)
  values ('ops@sigma.invalid', '[TEST] Sigma Feeds contact', 'feed_provider')
  returning id into user_a;

  insert into users (email, display_name, role)
  values ('ops@delta.test', '[TEST] Delta Data contact', 'feed_provider')
  returning id into user_b;

  insert into users (email, display_name, role)
  values ('ops@epsilon.invalid', '[TEST] Epsilon Signals contact', 'feed_provider')
  returning id into user_c;

  insert into provider_applications (user_id, name, email, status, applied_at, reviewed_at)
  values (user_a, '[TEST] Sigma Feeds', 'ops@sigma.invalid', 'approved', now() - interval '3 days', now() - interval '2 days')
  returning id into app_a;

  insert into provider_applications (user_id, name, email, status, applied_at, reviewed_at)
  values (user_b, '[TEST] Delta Data', 'ops@delta.test', 'approved', now() - interval '5 days', now() - interval '4 days')
  returning id into app_b;

  insert into provider_applications (user_id, name, email, status, applied_at, reviewed_at)
  values (user_c, '[TEST] Epsilon Signals', 'ops@epsilon.invalid', 'approved', now() - interval '4 days', now() - interval '3 days')
  returning id into app_c;

  select id into admin_user_id from users where role = 'admin' order by created_at limit 1;

  -- Provider A ([TEST] Sigma Feeds): single-tier first proposal, round 1, proposed.
  insert into provider_tier_proposals
    (application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
     trial_length_days, terms_status, created_at)
  values
    (app_a, user_a, 'Alpha', 34900, 65, 14, 'proposed', now() - interval '3 hours');

  -- Provider B ([TEST] Delta Data): round 1 declined (with note), round 2 resubmit proposed.
  insert into provider_tier_proposals
    (application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
     trial_length_days, terms_status, declined_note, decided_by, decided_at, created_at)
  values
    (app_b, user_b, 'Alpha', 59900, 75, 14, 'declined',
     '75% is too rich for a launch tier -- come back at 65-70 and we can revisit after volume picks up.',
     admin_user_id, now() - interval '1 day', now() - interval '2 days');

  insert into provider_tier_proposals
    (application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
     trial_length_days, terms_status, created_at)
  values
    (app_b, user_b, 'Alpha', 59900, 70, 14, 'proposed', now() - interval '5 hours');

  -- Provider C ([TEST] Epsilon Signals): two tiers in flight, both round 1 proposed.
  insert into provider_tier_proposals
    (application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
     trial_length_days, terms_status, created_at)
  values
    (app_c, user_c, 'Alpha', 49900, 70, 14, 'proposed', now() - interval '8 hours'),
    (app_c, user_c, 'Beta',  129900, 60, 14, 'proposed', now() - interval '7 hours');

  raise notice 'seeded [TEST] users % % %, applications % % %', user_a, user_b, user_c, app_a, app_b, app_c;
end $$;
