-- 0089: settle the six exempt rows (re-key, gate, lapse), remove the six-id exception from
-- feed_subscriptions_server_or_lapsed_chk, then drop the 0081 licence-keyed index. Follow-up to
-- 0088_tighten.sql (fable ruling 12:53Z 2026-09-13 ledger v1.71 3800e9d on marcus m49538_mtzt2uia;
-- stub order fable v1.76 addendum, relayed verbatim in marcus m49852_mtzwjuib). STUB: the shape
-- is fixed, the apply date is not. Thread kai-tighten-0087-2026-09-12.
--
-- WHEN: once none of the six exempt rows (giang2000ln 82147257 / 4a0a7fb8 / 00f9e32c, rasoolx55
-- a453d4c0 / 2e7ad400 / 1161625a) is still live with a NULL server. Natural expiry: giang
-- 2026-09-19 17:12Z (paid, may renew), rasool 2026-09-25 19:01Z (trial). Nothing in the system
-- ever writes a lapse: an expired row stays status='active' with a NULL server, so this file
-- lapses it itself (step 3) before the CHECK; without that step the expired six would pass the
-- live gate and then fail ADD CONSTRAINT with 23514 (fable v1.76, on marcus's 18-row read). The
-- gate decides, not the calendar. Run whole as one transaction; dry-run once with `rollback;` in
-- place of `commit;` and paste every notice line.
--
-- FILL IN BEFORE THE DRY-RUN: the six full uuids, byte-identical to the ones 0088 was applied
-- with (step 0 reads the live constraint back and refuses a mismatch).
--
-- WHAT THIS DOES, IN ORDER:
--   0. Ledger preflight: schema_migrations has '0088' and does not have '0089'. The live CHECK's
--      literal set must equal the list below (read back with pg_get_constraintdef).
--   1. RE-KEY: 0088 step 4's licence -> server backfill, same predicate, restricted to id in the
--      six. A client who registered a real server AFTER the 0088 run is bound here; before the
--      run, 0088 step 4 already did it and this is UPDATE 0. Row count into the summary.
--   2. GATE: rows live under the S4 predicate (server_registration_id is null and status <>
--      'lapsed' and (ends_at > now() or ends_at is null)) with an id in the six must be 0, else
--      abort naming each. A live one with no server is coxwell's to dispose of (a real server
--      row, or a worded lapse in 0088's 2b(b) form if 0088 has not run; here there is no slot:
--      abort, decision on the thread). Then, stated as its own gate, live NULL-server rows
--      outside the six = 0 (0088's CHECK forces it; a nonzero is a broken constraint).
--   3. LAPSE, word for word (fable v1.76):
--        update feed_subscriptions
--        set status = 'lapsed', lapsed_at = coalesce(lapsed_at, ends_at), updated_at = now()
--        where id in (<six>) and server_registration_id is null and status <> 'lapsed'
--          and ends_at <= now();
--      Row count into the summary. After 2 + 3 every one of the six is bound or stored lapsed.
--   4. Drop the CHECK and re-add it without the exception:
--        check (status = 'lapsed' or server_registration_id is not null)
--      Holds by construction: 0088's CHECK already forces every server-NULL row outside the six
--      to be lapsed, and steps 2 + 3 settle the six. Not `not valid` (0088 step 5 reasoning).
--   5. Preflight D on (server_registration_id, feed_tier_id) among live rows, all rows now (no
--      NULL-server exclusion: there are none), must be 0. Then
--        drop index if exists feed_subscriptions_license_feed_tier_live_uidx;   -- 0081
--      No replacement index: feed_subscriptions_server_feed_tier_live_uidx (0086) covers every
--      live row once every live row has a server. The 0078 provider_tier twin is not touched.
--   6. Summary row, then the ledger row ('0089', '0089_drop_server_or_lapsed_exception.sql').
--
-- After this file: the window check at src/lib/feed-subscriptions.ts:403-410 (REMOVAL POINT
-- comment :392, re-pointed to this file by the 0088 cleanup commit) is deleted, and `licenseId`
-- leaves assertNoLiveGrant's args (0087-tighten.md section 8, moved here from 0088).
--
-- Rollback: 0089_rollback.sql (recreates 0081 behind a duplicate-group preflight, restores the
-- CHECK with the exception, deletes the ledger row). It does NOT revert step 1 (the re-key is a
-- 0086 column backfill, left as written, exactly as 0088's rollback treats 0088 step 4) and does
-- NOT revert step 3 (stored 'lapsed' on a row whose ends_at is past is truthful either way,
-- exactly as 0088's rollback keeps the step-5 lapse).

begin;

create temp table tmp_0089_counts (k text primary key, v integer not null) on commit drop;

-- ---------------------------------------------------------------------------------------
-- 0. LEDGER PREFLIGHT, AND THE LIST MATCHES THE LIVE CHECK
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

-- Same list as 0088 (as applied); uuids from marcus's Neon read of 2026-09-13 14:55Z
-- (m49945_mtzxrd14). The read-back below aborts if the live CHECK carries a different list.
create temp table tmp_0089_exempt (id uuid primary key) on commit drop;
insert into tmp_0089_exempt (id) values
  ('82147257-d90b-4ed9-a12e-68adeaf0b2d4'),   -- giang2000ln (paid, $30, ends 2026-09-19T17:12:35.462Z)
  ('4a0a7fb8-0ac2-49f4-b7a8-4007a7c92500'),   -- giang2000ln
  ('00f9e32c-70e8-46f6-a74c-43317edf62c5'),   -- giang2000ln
  ('a453d4c0-fcb0-4643-a244-ad6e14273164'),   -- rasoolx55 (trial, $0, ends 2026-09-25T19:01:33.745Z)
  ('2e7ad400-9c26-440c-af09-44db1aa8d254'),   -- rasoolx55
  ('1161625a-72bb-4472-9282-16062f0cad13');   -- rasoolx55

do $$
declare
  def text;
  missing integer;
  literals integer;
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conrelid = 'feed_subscriptions'::regclass
    and c.conname = 'feed_subscriptions_server_or_lapsed_chk';
  if def is null then
    raise exception 'step 0: feed_subscriptions_server_or_lapsed_chk is not present; 0088 step 5 did not leave it';
  end if;
  select count(*) into missing from tmp_0089_exempt x where position(x.id::text in def) = 0;
  select count(*) into literals
  from regexp_matches(def, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g');
  if missing != 0 or literals != (select count(*) from tmp_0089_exempt) then
    raise exception 'step 0: the list in this file (% ids, % not in the constraint) does not match the live constraint (% literals). Definition: %',
      (select count(*) from tmp_0089_exempt), missing, literals, def;
  end if;
  raise notice 'step 0 list ok: exempt ids=% all in the live CHECK; definition=%', (select count(*) from tmp_0089_exempt), def;
end $$;

-- ---------------------------------------------------------------------------------------
-- 1. RE-KEY THE SIX (0088 step 4's predicate, restricted to the six)
-- ---------------------------------------------------------------------------------------

-- Expected: UPDATE 0 unless a client registered a real server after the 0088 run.
do $$
declare
  rekeyed integer;
begin
  update feed_subscriptions fs
  set server_registration_id = sr.id, updated_at = now()
  from server_registrations sr
  where sr.license_id = fs.license_id
    and fs.server_registration_id is null
    and fs.id in (select id from tmp_0089_exempt);
  get diagnostics rekeyed = row_count;
  insert into tmp_0089_counts (k, v) values ('exempt_rekeyed', rekeyed);
  raise notice 'step 1 ok: exempt rows re-keyed to a server=%', rekeyed;
end $$;

-- ---------------------------------------------------------------------------------------
-- 2. GATE: NO EXEMPT ROW IS STILL LIVE WITH A NULL SERVER
-- ---------------------------------------------------------------------------------------

do $$
declare
  r record;
  live_exempt integer;
  live_no_server_other integer;
begin
  select count(*) into live_exempt
  from feed_subscriptions fs
  join tmp_0089_exempt x on x.id = fs.id
  where fs.server_registration_id is null and fs.status <> 'lapsed'
    and (fs.ends_at > now() or fs.ends_at is null);
  if live_exempt != 0 then
    for r in
      select fs.id, coalesce(u.email, u.display_name, u.id::text) as subscriber,
             ft.tier_key, fs.status, fs.ends_at
      from feed_subscriptions fs
      join tmp_0089_exempt x on x.id = fs.id
      join users u on u.id = fs.subscriber_user_id
      left join feed_tiers ft on ft.id = fs.feed_tier_id
      where fs.server_registration_id is null and fs.status <> 'lapsed'
        and (fs.ends_at > now() or fs.ends_at is null)
      order by subscriber, ft.tier_key, fs.id
    loop
      raise notice 'step 2 STILL LIVE exempt row with no server: id=% subscriber=% tier=% status=% ends_at=%',
        r.id, r.subscriber, coalesce(r.tier_key, '(provider_tier)'), r.status, r.ends_at;
    end loop;
    raise exception 'step 2: % exempt row(s) still live with a NULL server (listed above); the exception cannot be removed yet. A real server row, or a worded lapse on the thread; this file adds neither', live_exempt;
  end if;

  select count(*) into live_no_server_other
  from feed_subscriptions fs
  where fs.server_registration_id is null and fs.status <> 'lapsed'
    and (fs.ends_at > now() or fs.ends_at is null)
    and not exists (select 1 from tmp_0089_exempt x where x.id = fs.id);
  if live_no_server_other != 0 then
    raise exception 'step 2: % live feed_subscriptions row(s) with NULL server outside the exempt set; the 0088 CHECK should have refused them', live_no_server_other;
  end if;
  raise notice 'step 2 ok: live NULL-server exempt rows=0, live NULL-server rows outside the six=0';
end $$;

-- ---------------------------------------------------------------------------------------
-- 3. LAPSE THE EXPIRED EXEMPT ROWS (fable v1.76, word for word)
-- ---------------------------------------------------------------------------------------

-- Expected: UPDATE = the number of the six that ran out unrenewed and unbound (0..6).
do $$
declare
  lapsed integer;
begin
  update feed_subscriptions
  set status = 'lapsed', lapsed_at = coalesce(lapsed_at, ends_at), updated_at = now()
  where id in (select id from tmp_0089_exempt)
    and server_registration_id is null and status <> 'lapsed' and ends_at <= now();
  get diagnostics lapsed = row_count;
  insert into tmp_0089_counts (k, v) values ('exempt_lapsed_now', lapsed);
  raise notice 'step 3 ok: exempt rows lapsed now=%', lapsed;
end $$;

-- ---------------------------------------------------------------------------------------
-- 4. THE CHECK WITHOUT THE EXCEPTION
-- ---------------------------------------------------------------------------------------

-- Expected: ALTER TABLE, ALTER TABLE. Holds by construction after steps 2 + 3.
alter table feed_subscriptions
  drop constraint feed_subscriptions_server_or_lapsed_chk;

alter table feed_subscriptions
  add constraint feed_subscriptions_server_or_lapsed_chk
  check (status = 'lapsed' or server_registration_id is not null);

-- ---------------------------------------------------------------------------------------
-- 5. PREFLIGHT D, THEN DROP THE 0081 INDEX
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
    raise exception 'step 5 preflight D: % live (server, tier) duplicate groups', dup_groups;
  end if;
  raise notice 'step 5 preflight D ok: live (server, tier) duplicate groups=0';
end $$;

-- Expected: DROP INDEX.
drop index if exists feed_subscriptions_license_feed_tier_live_uidx;

-- ---------------------------------------------------------------------------------------
-- 6. SUMMARY, THEN THE LEDGER ROW
-- ---------------------------------------------------------------------------------------

-- Expected: one row. exempt_rekeyed + exempt_lapsed_now + exempt_already_settled = 6;
-- fs_no_server_live=0; index_0081_present=false.
select
  (select v from tmp_0089_counts where k = 'exempt_rekeyed') as exempt_rekeyed,
  (select v from tmp_0089_counts where k = 'exempt_lapsed_now') as exempt_lapsed_now,
  (select count(*) from feed_subscriptions fs join tmp_0089_exempt x on x.id = fs.id
     where fs.status = 'lapsed' or fs.server_registration_id is not null)
    - (select v from tmp_0089_counts where k = 'exempt_rekeyed')
    - (select v from tmp_0089_counts where k = 'exempt_lapsed_now') as exempt_already_settled,
  (select count(*) from feed_subscriptions
     where server_registration_id is null and status <> 'lapsed'
       and (ends_at > now() or ends_at is null)) as fs_no_server_live,
  (select to_regclass('feed_subscriptions_license_feed_tier_live_uidx') is not null) as index_0081_present;

insert into schema_migrations (version, name) values
  ('0089', '0089_drop_server_or_lapsed_exception.sql')
on conflict (version) do nothing;

commit;
