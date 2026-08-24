-- Seed data for /admin/providers "Needs terms review" smoke test.
-- Bus thread provider-terms-negotiation-2026-08-24 (marcus m29347+ decision): seeding is
-- a prerequisite for coxwell's first look, not a nice-to-have -- an empty queue tells him
-- nothing. Three scenarios, one command, idempotent.
--
-- Picks the 3 oldest approved+linked provider_applications (user_id is not null) rather
-- than fabricating fake providers -- if the book has fewer than 3 such applications, this
-- aborts loudly instead of silently seeding nothing or seeding against a bogus provider.
-- Selection is deterministic (applied_at order), so re-running always targets the same
-- three applications and never drifts onto real data.
--
-- Provider A: single-tier, round 1, first proposal -- the simplest confirm path, no
-- prior history to render.
--
-- Provider B: resubmit after decline -- round 1 (75% split) declined with a note, round 2
-- (70% split) pending, both same tier/application, so §3.4's lineage timeline shows real
-- movement instead of a single node.
--
-- Provider C: two tiers in flight on one application -- Alpha and Beta, different fees
-- and splits, both round 1 pending -- exercises §3.5's group-by-provider-decide-per-tier.
--
-- Idempotent: deletes any existing provider_tier_proposals rows for exactly the 3 selected
-- application_ids before inserting, so re-running after clicking Confirm/Decline resets to
-- this fixed seeded state. Never touches proposals for any other application.
--
-- Run manually with: psql "$NEON_DATABASE_URL" -f scripts/seed_terms_review_queue.sql
-- (or the project's usual one-off @neondatabase/serverless runner). NOT wired into any
-- migration or automated path -- seed data must never run against prod by accident.

do $$
declare
  provider_a record;
  provider_b record;
  provider_c record;
  admin_user_id uuid;
begin
  select id, user_id into provider_a
  from provider_applications
  where user_id is not null
  order by applied_at
  limit 1;

  select id, user_id into provider_b
  from provider_applications
  where user_id is not null and id <> provider_a.id
  order by applied_at
  offset 1 limit 1;

  select id, user_id into provider_c
  from provider_applications
  where user_id is not null and id not in (provider_a.id, provider_b.id)
  order by applied_at
  offset 2 limit 1;

  if provider_a.id is null or provider_b.id is null or provider_c.id is null then
    raise exception 'seed_terms_review_queue: need at least 3 approved+linked provider_applications, found fewer';
  end if;

  select id into admin_user_id from users where role = 'admin' order by created_at limit 1;

  delete from provider_tier_proposals
  where application_id in (provider_a.id, provider_b.id, provider_c.id);

  -- Provider A: single-tier first proposal, round 1, proposed.
  insert into provider_tier_proposals
    (application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
     trial_length_days, terms_status, created_at)
  values
    (provider_a.id, provider_a.user_id, 'Alpha', 34900, 65, 14, 'proposed', now() - interval '3 hours');

  -- Provider B: round 1 declined (with note), round 2 resubmit proposed -- 75% -> 70%.
  insert into provider_tier_proposals
    (application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
     trial_length_days, terms_status, declined_note, decided_by, decided_at, created_at)
  values
    (provider_b.id, provider_b.user_id, 'Alpha', 59900, 75, 14, 'declined',
     '75% is too rich for a launch tier -- come back at 65-70 and we can revisit after volume picks up.',
     admin_user_id, now() - interval '1 day', now() - interval '2 days');

  insert into provider_tier_proposals
    (application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
     trial_length_days, terms_status, created_at)
  values
    (provider_b.id, provider_b.user_id, 'Alpha', 59900, 70, 14, 'proposed', now() - interval '5 hours');

  -- Provider C: two tiers in flight, different fees and splits, both round 1 proposed.
  insert into provider_tier_proposals
    (application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
     trial_length_days, terms_status, created_at)
  values
    (provider_c.id, provider_c.user_id, 'Alpha', 49900, 70, 14, 'proposed', now() - interval '8 hours'),
    (provider_c.id, provider_c.user_id, 'Beta',  129900, 60, 14, 'proposed', now() - interval '7 hours');
end $$;
