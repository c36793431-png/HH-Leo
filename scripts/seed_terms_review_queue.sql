-- Seed data for /admin/providers "Needs terms review" smoke test.
-- Bus thread provider-terms-negotiation-2026-08-24 (marcus): the queue table is empty
-- (nothing has ever written to provider_tier_proposals), so coxwell's first click would
-- hit the empty state. Marcus asked for 2-3 realistic pending proposals ready as one
-- command, NOT to be run until he confirms coxwell wants seeded data.
--
-- Picks two existing approved+linked provider_applications (application.user_id is not
-- null) to attach proposals to, rather than fabricating fake providers -- if the book
-- has fewer than 2 such applications, this aborts loudly instead of silently seeding
-- nothing or seeding against a bogus provider.
--
-- Provider A: single tier, round 1, first proposal (context = "first proposal" in the
-- queue UI).
-- Provider B: two tiers in flight, both round 1, so §3.5's per-tier grouping is
-- actually exercised (two adjacent rows, same provider name).
--
-- Run manually with: psql "$NEON_DATABASE_URL" -f scripts/seed_terms_review_queue.sql
-- (or the project's usual one-off @neondatabase/serverless runner). NOT wired into any
-- migration or automated path -- seed data must never run against prod by accident.

do $$
declare
  provider_a record;
  provider_b record;
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

  if provider_a.id is null or provider_b.id is null then
    raise exception 'seed_terms_review_queue: need at least 2 approved+linked provider_applications, found fewer';
  end if;

  insert into provider_tier_proposals
    (application_id, provider_user_id, tier_name, client_price_cents, provider_split_pct,
     trial_length_days, terms_status, created_at)
  values
    (provider_a.id, provider_a.user_id, 'Alpha', 29900, 60, 14, 'pending', now() - interval '2 hours'),
    (provider_b.id, provider_b.user_id, 'Alpha', 49900, 55, 14, 'pending', now() - interval '6 hours'),
    (provider_b.id, provider_b.user_id, 'Beta',  99900, 50, 14, 'pending', now() - interval '1 day');
end $$;
