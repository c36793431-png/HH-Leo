-- Repro fixture for the /admin/users and /dashboard multi-license display fix.
-- Bus thread multi-license-visibility-2026-08-31 (marcus): coxwell's own two-license state
-- (paid + a 1-day test license) is the only thing that has exercised this so far, and his
-- test license expires 2026-09-01 18:27 UTC -- once it lapses, his account drops back to
-- one active license and the multi-license path stops being reachable through his data.
-- This creates a dedicated test user that holds two active licenses (paid + team, same
-- shape as coxwell's case) independent of anyone's real account, so the fix stays
-- verifiable on demand. Idempotent -- re-running updates the fixture's own rows in place
-- rather than accumulating duplicates; touches nothing outside the qa-multi-license@ user.

do $$
declare
  test_user_id uuid;
begin
  select id into test_user_id from users where email = 'qa-multi-license@horizonhft.internal';

  if test_user_id is null then
    insert into users (email, display_name, role)
    values ('qa-multi-license@horizonhft.internal', 'QA Multi-License Fixture', 'user')
    returning id into test_user_id;
  end if;

  -- Clear any licenses from a prior run of this script so re-running gives a clean,
  -- predictable two-row state instead of accumulating one pair per run.
  delete from licenses where user_id = test_user_id;

  insert into licenses (user_id, license_key, status, expires_at, tier, feed_types)
  values
    (test_user_id, 'HHFT-QA-PAID-' || substr(md5(random()::text), 1, 6), 'active', now() + interval '30 days', 'paid', array['us_equities']),
    (test_user_id, 'HHFT-QA-TEAM-' || substr(md5(random()::text), 1, 6), 'active', now() + interval '2 days', 'team', array['crypto']);

  raise notice 'Seeded qa-multi-license@horizonhft.internal (user_id=%) with 2 active licenses', test_user_id;
end $$;
