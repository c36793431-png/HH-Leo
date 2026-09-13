-- 0089: remove the six-id exception from feed_subscriptions_server_or_lapsed_chk, then drop the
-- 0081 licence-keyed index. Follow-up to 0088_tighten.sql (fable ruling 12:53Z 2026-09-13, ledger
-- v1.71 3800e9d, on marcus m49538_mtzt2uia). STUB: the shape is fixed, the apply date is not.
-- Thread kai-tighten-0087-2026-09-12.
--
-- WHEN: once every one of the six exempt rows (giang2000ln 82147257 / 4a0a7fb8 / 00f9e32c,
-- rasoolx55 a453d4c0 / 2e7ad400 / 1161625a) is either bound to a real server row or lapsed.
-- Natural expiry: giang 2026-09-19 17:12Z (paid, may renew), rasool 2026-09-25 19:01Z (trial).
-- The gate below decides, not the calendar. Run whole as one transaction; dry-run once with
-- `rollback;` in place of `commit;` and paste every notice line.
--
-- FILL IN BEFORE THE DRY-RUN: the six full uuids, byte-identical to the ones in 0088 step 5 (or
-- the pruned list 0088 was actually applied with, read back from the live constraint: step 1
-- refuses a mismatch).
--
-- WHAT THIS DOES, IN ORDER:
--   0. Ledger preflight: schema_migrations has '0088' and does not have '0089'.
--   1. The live CHECK's literal set must equal the list below (read back with
--      pg_get_constraintdef); live rows (status <> 'lapsed' and (ends_at > now() or ends_at is
--      null)) with an exempt id must be 0, every remaining one named; live rows with NULL server
--      must be 0 (structurally so once the first count is 0, stated as its own gate).
--   2. Drop the CHECK and re-add it without the exception:
--        check (status = 'lapsed' or server_registration_id is not null)
--      Not `not valid` (0088 step 5 reasoning; with the gate at 0 it holds at ADD).
--   3. Preflight D on (server_registration_id, feed_tier_id) among live rows, all rows now (no
--      NULL-server exclusion: there are none), must be 0. Then
--        drop index if exists feed_subscriptions_license_feed_tier_live_uidx;   -- 0081
--      No replacement index: feed_subscriptions_server_feed_tier_live_uidx (0086) covers every
--      live row once every live row has a server. The 0078 provider_tier twin is not touched.
--   4. Ledger row ('0089', '0089_drop_server_or_lapsed_exception.sql').
--
-- After this file: the window check at src/lib/feed-subscriptions.ts:403-410 (REMOVAL POINT
-- comment :392, re-pointed to this file by the 0088 cleanup commit) is deleted, and `licenseId`
-- leaves assertNoLiveGrant's args (0087-tighten.md section 8, moved here from 0088).
--
-- Rollback: 0089_rollback.sql (recreates 0081 behind a duplicate-group preflight, restores the
-- CHECK with the exception, deletes the ledger row).

begin;

-- ---------------------------------------------------------------------------------------
-- 0. LEDGER PREFLIGHT
-- ---------------------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from schema_migrations where version = '0088') then
    raise exception 'step 0: schema_migrations has no 0088 row; 0088_tighten.sql must be applied first';
  end if;
  if exists (select 1 from schema_migrations where version = '0089') then
    raise exception 'step 0: schema_migrations already has a 0089 row; this file has been applied';
  end if;
  raise notice 'step 0 ok: 0088 present, 0089 absent';
end $$;

-- ---------------------------------------------------------------------------------------
-- 1. THE EXEMPT SET IS EMPTY OF LIVE ROWS
-- ---------------------------------------------------------------------------------------

-- Same list as 0088 step 5 (as applied). Placeholders fail the uuid cast (22P02) on purpose.
create temp table tmp_0089_exempt (id uuid primary key) on commit drop;
insert into tmp_0089_exempt (id) values
  ('82147257-FILL-IN-FULL-UUID'),   -- giang2000ln, LD Base tier 1
  ('4a0a7fb8-FILL-IN-FULL-UUID'),   -- giang2000ln, LD Base tier 2
  ('00f9e32c-FILL-IN-FULL-UUID'),   -- giang2000ln, LD Base tier 3
  ('a453d4c0-FILL-IN-FULL-UUID'),   -- rasoolx55, LD Base tier 1
  ('2e7ad400-FILL-IN-FULL-UUID'),   -- rasoolx55, LD Base tier 2
  ('1161625a-FILL-IN-FULL-UUID');   -- rasoolx55, LD Base tier 3

do $$
declare
  r record;
  def text;
  missing integer;
  literals integer;
  live_exempt integer;
  live_no_server integer;
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conrelid = 'feed_subscriptions'::regclass
    and c.conname = 'feed_subscriptions_server_or_lapsed_chk';
  if def is null then
    raise exception 'step 1: feed_subscriptions_server_or_lapsed_chk is not present; 0088 step 5 did not leave it';
  end if;
  select count(*) into missing from tmp_0089_exempt x where position(x.id::text in def) = 0;
  select count(*) into literals
  from regexp_matches(def, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g');
  if missing != 0 or literals != (select count(*) from tmp_0089_exempt) then
    raise exception 'step 1: the list in this file (% ids, % not in the constraint) does not match the live constraint (% literals). Definition: %',
      (select count(*) from tmp_0089_exempt), missing, literals, def;
  end if;

  select count(*) into live_exempt
  from feed_subscriptions fs
  join tmp_0089_exempt x on x.id = fs.id
  where fs.status <> 'lapsed' and (fs.ends_at > now() or fs.ends_at is null);
  if live_exempt != 0 then
    for r in
      select fs.id, coalesce(u.email, u.display_name, u.id::text) as subscriber,
             ft.tier_key, fs.status, fs.ends_at, fs.server_registration_id
      from feed_subscriptions fs
      join tmp_0089_exempt x on x.id = fs.id
      join users u on u.id = fs.subscriber_user_id
      left join feed_tiers ft on ft.id = fs.feed_tier_id
      where fs.status <> 'lapsed' and (fs.ends_at > now() or fs.ends_at is null)
      order by subscriber, ft.tier_key, fs.id
    loop
      raise notice 'step 1 STILL LIVE exempt row: id=% subscriber=% tier=% status=% ends_at=% server_registration_id=%',
        r.id, r.subscriber, coalesce(r.tier_key, '(provider_tier)'), r.status, r.ends_at, r.server_registration_id;
    end loop;
    raise exception 'step 1: % exempt row(s) still live (listed above); the exception cannot be removed yet. Wait for expiry or a real server binding; no lapse by migration', live_exempt;
  end if;

  select count(*) into live_no_server
  from feed_subscriptions
  where server_registration_id is null and status <> 'lapsed'
    and (ends_at > now() or ends_at is null);
  if live_no_server != 0 then
    raise exception 'step 1: % live feed_subscriptions row(s) with NULL server outside the exempt set; the 0088 CHECK should have refused them', live_no_server;
  end if;
  raise notice 'step 1 ok: exempt ids=% live exempt=0 live NULL-server=0', (select count(*) from tmp_0089_exempt);
end $$;

-- ---------------------------------------------------------------------------------------
-- 2. THE CHECK WITHOUT THE EXCEPTION
-- ---------------------------------------------------------------------------------------

-- Expected: ALTER TABLE, ALTER TABLE.
alter table feed_subscriptions
  drop constraint feed_subscriptions_server_or_lapsed_chk;

alter table feed_subscriptions
  add constraint feed_subscriptions_server_or_lapsed_chk
  check (status = 'lapsed' or server_registration_id is not null);

-- ---------------------------------------------------------------------------------------
-- 3. PREFLIGHT D, THEN DROP THE 0081 INDEX
-- ---------------------------------------------------------------------------------------

do $$
declare
  dup_groups integer;
begin
  select count(*) into dup_groups
  from (
    select fs.server_registration_id, fs.feed_tier_id
    from feed_subscriptions fs
    where fs.feed_tier_id is not null and fs.status in ('trial', 'active')
    group by fs.server_registration_id, fs.feed_tier_id
    having count(*) > 1
  ) d;
  if dup_groups != 0 then
    raise exception 'step 3 preflight D: % live (server, tier) duplicate groups', dup_groups;
  end if;
  raise notice 'step 3 preflight D ok: live (server, tier) duplicate groups=0';
end $$;

-- Expected: DROP INDEX.
drop index if exists feed_subscriptions_license_feed_tier_live_uidx;

-- ---------------------------------------------------------------------------------------
-- 4. LEDGER ROW
-- ---------------------------------------------------------------------------------------

insert into schema_migrations (version, name) values
  ('0089', '0089_drop_server_or_lapsed_exception.sql')
on conflict (version) do nothing;

commit;
