-- 0089: settle the rows 0088 carried (re-key, gate, lapse), remove the id exception from
-- feed_subscriptions_server_or_lapsed_chk, then drop the 0081 licence-keyed index. Follow-up to
-- 0088_tighten.sql (fable ruling 12:53Z 2026-09-13 ledger v1.71 3800e9d on marcus m49538_mtzt2uia;
-- stub order fable v1.76 addendum, relayed verbatim in marcus m49852_mtzwjuib). STUB: the shape
-- is fixed, the apply date is not. Thread kai-tighten-0087-2026-09-12.
--
-- WHEN: once none of the rows 0088 carried in the CHECK's exception is still live with a NULL
-- server. Nothing in the system ever writes a lapse: an expired row stays status='active' with a
-- NULL server, so this file lapses it itself (step 3) before the CHECK; without that step an
-- expired carried row would pass the live gate and then fail ADD CONSTRAINT with 23514 (fable
-- v1.76, on marcus's 18-row read). The gate decides, not the calendar. Run whole as one
-- transaction; dry-run once with `rollback;` in place of `commit;` and paste every notice line.
--
-- NO CLIENT LIST IS COMMITTED IN THIS FILE (marcus m50350_mu0ztzip, 2026-09-14). R4..R8 carried
-- six uuids here, byte-identical to 0088's; 0088 no longer writes a list at all -- it computes
-- its carve-out at run time and materialises it in the constraint text -- and a list written here
-- would be a second thing to go stale. Step 0 reads the carried ids back OUT of the live
-- constraint with pg_get_constraintdef, which is by definition the set 0088 actually left. An
-- empty set (0088 found nothing to carry) is legitimate: steps 1-3 are then no-ops and step 4
-- re-adds the same constraint text the catalog already has.
--
-- WHAT THIS DOES, IN ORDER:
--   0. The run's now(), printed as the first notice of the run; then ledger preflight:
--      schema_migrations has '0088' and does not have '0089'. Then the carried
--      set: every uuid literal in pg_get_constraintdef of feed_subscriptions_server_or_lapsed_chk,
--      into tmp_0089_carried. Zero literals is legitimate and noticed as such.
--   1. RE-KEY: 0088 step 4's licence -> server backfill, same predicate, restricted to the carried
--      ids. A client who registered a real server AFTER the 0088 run is bound here; before the
--      run, 0088 step 4 already did it and this is UPDATE 0. Row count into the summary.
--   2. GATE: rows live under the S4 predicate (server_registration_id is null and status <>
--      'lapsed' and (ends_at > now() or ends_at is null)) with a carried id must be 0, else
--      abort naming each. A live one with no server is coxwell's to dispose of (a real server
--      row, or a worded lapse in 0088's 2b(b) form if 0088 has not run; here there is no slot:
--      abort, decision on the thread). Then, stated as its own gate, live NULL-server rows
--      outside the carried set = 0 (0088's CHECK forces it; a nonzero is a broken constraint).
--   3. REFUSAL GATE, THEN THE LAPSE (the 0088 step-4b shape, marcus m50350_mu0ztzip). Gate: every
--      carried row this step is about to lapse must already compute 'lapsed' under
--      EFFECTIVE_STATUS_SQL (src/lib/feed-subscriptions.ts:140-159, transcribed in step 3), else
--      abort naming it -- a carried row whose licence was renewed in place is still live to the
--      reader, and lapsing it would revoke access. Then the lapse, fable v1.76 with `<= now()`
--      tightened to `< now()` to match 0088 4b (marcus m50350):
--        update feed_subscriptions
--        set status = 'lapsed', lapsed_at = coalesce(lapsed_at, ends_at), updated_at = now()
--        where id in (<carried>) and server_registration_id is null and status <> 'lapsed'
--          and ends_at < now();
--      Row count into the summary. After 2 + 3 every carried row is bound or stored lapsed.
--   4. A last gate -- NULL-server non-lapsed rows anywhere in the table = 0, each named -- then
--      drop the CHECK and re-add it without the exception:
--        check (status = 'lapsed' or server_registration_id is not null)
--      The gate is what the ADD CONSTRAINT needs and it is stated rather than assumed: 0088's
--      CHECK forces every server-NULL row outside the carried set to be lapsed and steps 2 + 3
--      settle the carried ones, but a row whose ends_at is exactly this transaction's now()
--      satisfies neither step 2's `> now()` nor step 3's `< now()`. Aborting named beats a 23514
--      from the ALTER; the fix is to re-run. Not `not valid` (0088 step 5 reasoning).
--   5. Preflight D on (server_registration_id, feed_tier_id) among live rows, all rows now (no
--      NULL-server exclusion: there are none), must be 0. Then
--        drop index if exists feed_subscriptions_license_feed_tier_live_uidx;   -- 0081
--      No replacement index: feed_subscriptions_server_feed_tier_live_uidx (0086) covers every
--      live row once every live row has a server. The 0078 provider_tier twin is not touched.
--   6. Summary row, carrying the run's now() again as its own column, then the ledger row
--      ('0089', '0089_drop_server_or_lapsed_exception.sql').
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
  -- The run's own clock, before anything else, and repeated as a column of the step 6 summary.
  -- Same reasoning as 0088_tighten.sql step 0 (marcus m50485_mu11vkq7, 2026-09-14): this file's
  -- step 2 liveness gate, step 3 refusal gate and step 4 no-server gate are all stated relative
  -- to THIS instant, and its paste is compared with 0088's. Its two sites were named for 0088;
  -- the property that selects them is "a pasted run whose gates are evaluated against now()",
  -- and this file has it too. now(), not clock_timestamp() and not a literal.
  raise notice 'run now()=%', now();
  if not exists (select 1 from schema_migrations where version = '0088') then
    raise exception 'step 0: schema_migrations has no 0088 row; 0088_tighten.sql must be applied first';
  end if;
  if exists (select 1 from schema_migrations where version = '0089') then
    raise exception 'step 0: schema_migrations already has a 0089 row; this file has been applied';
  end if;
  raise notice 'step 0 ok: 0088 present, 0089 absent';
end $$;

-- The carried set is READ OUT of the live constraint, not written down here (marcus
-- m50350_mu0ztzip, 2026-09-14). 0088 step 5 computes its carve-out from the data on the day it
-- runs and materialises it in the constraint text; the catalog is therefore the only place that
-- knows which rows were carried, and a copy in this file could only be a second thing to go
-- stale. Zero literals is legitimate: 0088 found nothing to carry, steps 1-3 are no-ops.
create temp table tmp_0089_carried (id uuid primary key) on commit drop;

do $$
declare
  def text;
  carried integer;
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conrelid = 'feed_subscriptions'::regclass
    and c.conname = 'feed_subscriptions_server_or_lapsed_chk';
  if def is null then
    raise exception 'step 0: feed_subscriptions_server_or_lapsed_chk is not present; 0088 step 5 did not leave it';
  end if;

  -- `as m(parts)` names the column explicitly: regexp_matches returns text[], and an unqualified
  -- one-word alias would be ambiguous between the column and the whole row.
  insert into tmp_0089_carried (id)
  select distinct (m.parts[1])::uuid
  from regexp_matches(def, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g') as m(parts);

  select count(*) into carried from tmp_0089_carried;
  raise notice 'step 0 carried set read from the live CHECK: ids=%; definition=%', carried, def;
end $$;

-- ---------------------------------------------------------------------------------------
-- 1. RE-KEY THE CARRIED ROWS (0088 step 4's predicate, restricted to the carried set)
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
    and fs.id in (select id from tmp_0089_carried);
  get diagnostics rekeyed = row_count;
  insert into tmp_0089_counts (k, v) values ('carried_rekeyed', rekeyed);
  raise notice 'step 1 ok: carried rows re-keyed to a server=%', rekeyed;
end $$;

-- ---------------------------------------------------------------------------------------
-- 2. GATE: NO CARRIED ROW IS STILL LIVE WITH A NULL SERVER
-- ---------------------------------------------------------------------------------------

do $$
declare
  r record;
  live_carried integer;
  live_no_server_other integer;
begin
  select count(*) into live_carried
  from feed_subscriptions fs
  join tmp_0089_carried x on x.id = fs.id
  where fs.server_registration_id is null and fs.status <> 'lapsed'
    and (fs.ends_at > now() or fs.ends_at is null);
  if live_carried != 0 then
    for r in
      select fs.id, coalesce(u.email, u.display_name, u.id::text) as subscriber,
             ft.tier_key, fs.status, fs.ends_at
      from feed_subscriptions fs
      join tmp_0089_carried x on x.id = fs.id
      join users u on u.id = fs.subscriber_user_id
      left join feed_tiers ft on ft.id = fs.feed_tier_id
      where fs.server_registration_id is null and fs.status <> 'lapsed'
        and (fs.ends_at > now() or fs.ends_at is null)
      order by subscriber, ft.tier_key, fs.id
    loop
      raise notice 'step 2 STILL LIVE carried row with no server: id=% subscriber=% tier=% status=% ends_at=%',
        r.id, r.subscriber, coalesce(r.tier_key, '(provider_tier)'), r.status, r.ends_at;
    end loop;
    raise exception 'step 2: % carried row(s) still live with a NULL server (listed above); the exception cannot be removed yet. A real server row, or a worded lapse on the thread; this file adds neither', live_carried;
  end if;

  select count(*) into live_no_server_other
  from feed_subscriptions fs
  where fs.server_registration_id is null and fs.status <> 'lapsed'
    and (fs.ends_at > now() or fs.ends_at is null)
    and not exists (select 1 from tmp_0089_carried x where x.id = fs.id);
  if live_no_server_other != 0 then
    raise exception 'step 2: % live feed_subscriptions row(s) with NULL server outside the carried set; the 0088 CHECK should have refused them', live_no_server_other;
  end if;
  raise notice 'step 2 ok: live NULL-server carried rows=0, live NULL-server rows outside the carried set=0';
end $$;

-- ---------------------------------------------------------------------------------------
-- 3. REFUSAL GATE, THEN LAPSE THE EXPIRED CARRIED ROWS
-- ---------------------------------------------------------------------------------------

-- Same shape as 0088 step 4b (marcus m50350_mu0ztzip, 2026-09-14): a stored lapse is only
-- housekeeping while the reader already calls the row lapsed. computed_status below is
-- EFFECTIVE_STATUS_SQL transcribed from src/lib/feed-subscriptions.ts:140-159 (blob 94fa705,
-- branch head e1835fb, 2026-09-14) with s -> fs, and REGION_TO_FEED_TYPE_SQL from :114 inlined.
-- The live case this catches: a carried client renewed in place, so the licence branch keeps the
-- row non-lapsed even though its own ends_at is past. Step 2 above cannot see that row (it gates
-- on ends_at, not on the licence), so without this gate step 3 would silently revoke it.
-- Expected: non_lapsed=0, and UPDATE = the number of carried rows that ran out unrenewed and
-- unbound. fable v1.76's `ends_at <= now()` is tightened to `< now()` to match 0088 4b; the
-- equality knife-edge it opens is closed by step 4's gate, not left to ADD CONSTRAINT.
do $$
declare
  r record;
  candidates integer;
  non_lapsed integer;
  lapsed integer;
begin
  -- LEFT join users: this table decides what gets lapsed, so a row must not fall out of the gate
  -- because its subscriber row is missing.
  create temp table tmp_0089_lapse_candidates on commit drop as
  select fs.id,
         coalesce(u.email, u.display_name, fs.subscriber_user_id::text) as subscriber,
         ft.tier_key, fs.status, fs.ends_at,
         case
           when fs.status = 'lapsed' then 'lapsed'
           when ft.region_key is null then fs.status
           when (case ft.region_key when 'london' then 'london' when 'ny' then 'ny'
                                    when 'tokyo' then 'crypto' else null end) is null then fs.status
           when exists (
             select 1 from licenses l
             where l.id = fs.license_id
               and l.status = 'active' and l.expires_at > now()
           ) then fs.status
           when exists (
             select 1 from feed_tier_trials ftt
             where ftt.user_id = fs.subscriber_user_id
               and ftt.tier_key = ft.tier_key
               and ftt.trial_status = 'active'
               and ftt.trial_ends_at > now()
           ) then fs.status
           else 'lapsed'
         end as computed_status
  from feed_subscriptions fs
  join tmp_0089_carried x on x.id = fs.id
  left join users u on u.id = fs.subscriber_user_id
  left join feed_tiers ft on ft.id = fs.feed_tier_id
  where fs.server_registration_id is null and fs.status <> 'lapsed' and fs.ends_at < now();

  select count(*) into candidates from tmp_0089_lapse_candidates;
  select count(*) into non_lapsed from tmp_0089_lapse_candidates where computed_status <> 'lapsed';
  if non_lapsed != 0 then
    for r in
      select id, subscriber, tier_key, status, ends_at, computed_status
      from tmp_0089_lapse_candidates where computed_status <> 'lapsed'
      order by subscriber, tier_key, id
    loop
      raise notice 'step 3 REFUSE (still live to the reader): id=% subscriber=% tier=% status=% ends_at=% computed=%',
        r.id, r.subscriber, coalesce(r.tier_key, '(provider_tier)'), r.status, r.ends_at, r.computed_status;
    end loop;
    raise exception 'step 3: % of % carried row(s) with a past ends_at still compute non-lapsed under EFFECTIVE_STATUS_SQL (listed above); lapsing them would revoke access a client has today. Stop and take each row to the thread', non_lapsed, candidates;
  end if;

  update feed_subscriptions fs
  set status = 'lapsed', lapsed_at = coalesce(fs.lapsed_at, fs.ends_at), updated_at = now()
  from tmp_0089_lapse_candidates c
  where fs.id = c.id and fs.status <> 'lapsed';
  get diagnostics lapsed = row_count;
  if lapsed != candidates then
    raise exception 'step 3: gate cleared % candidate(s) but the lapse updated %; the two must be equal', candidates, lapsed;
  end if;
  insert into tmp_0089_counts (k, v) values ('carried_lapsed_now', lapsed);
  raise notice 'step 3 ok: candidates=% computed_non_lapsed=0 carried rows lapsed now=%', candidates, lapsed;
end $$;

-- ---------------------------------------------------------------------------------------
-- 4. THE CHECK WITHOUT THE EXCEPTION
-- ---------------------------------------------------------------------------------------

-- The precondition, stated instead of assumed: nothing non-lapsed is left with a NULL server,
-- carried or not. Steps 2 + 3 make it true except for a row whose ends_at is exactly this
-- transaction's now() (neither `> now()` nor `< now()`), which would otherwise surface as a 23514
-- out of the ALTER below. Named abort; the fix is to re-run.
do $$
declare
  r record;
  blockers integer;
begin
  select count(*) into blockers
  from feed_subscriptions
  where server_registration_id is null and status <> 'lapsed';
  if blockers != 0 then
    for r in
      select fs.id, coalesce(u.email, u.display_name, fs.subscriber_user_id::text) as subscriber,
             ft.tier_key, fs.status, fs.ends_at,
             exists (select 1 from tmp_0089_carried x where x.id = fs.id) as carried
      from feed_subscriptions fs
      left join users u on u.id = fs.subscriber_user_id
      left join feed_tiers ft on ft.id = fs.feed_tier_id
      where fs.server_registration_id is null and fs.status <> 'lapsed'
      order by subscriber, ft.tier_key, fs.id
    loop
      raise notice 'step 4 BLOCK no-server non-lapsed row: id=% subscriber=% tier=% status=% ends_at=% carried=%',
        r.id, r.subscriber, coalesce(r.tier_key, '(provider_tier)'), r.status, r.ends_at, r.carried;
    end loop;
    raise exception 'step 4: % no-server non-lapsed row(s) remain (listed above); ADD CONSTRAINT would fail 23514', blockers;
  end if;
  raise notice 'step 4 gate ok: no-server non-lapsed rows=0';
end $$;

-- Expected: ALTER TABLE, ALTER TABLE.
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

-- Expected: one row. carried_rekeyed + carried_lapsed_now + carried_already_settled = carried_ids
-- (whatever 0088 left; 0 is legitimate); fs_no_server_live=0; index_0081_present=false.
-- run_now: the same now() the step 0 notice printed, carried here so the instant and the counts
-- it dates cannot be split across two messages of a paste (marcus m50485_mu11vkq7, 2026-09-14).
select
  now() as run_now,
  (select count(*) from tmp_0089_carried) as carried_ids,
  (select v from tmp_0089_counts where k = 'carried_rekeyed') as carried_rekeyed,
  (select v from tmp_0089_counts where k = 'carried_lapsed_now') as carried_lapsed_now,
  (select count(*) from feed_subscriptions fs join tmp_0089_carried x on x.id = fs.id
     where fs.status = 'lapsed' or fs.server_registration_id is not null)
    - (select v from tmp_0089_counts where k = 'carried_rekeyed')
    - (select v from tmp_0089_counts where k = 'carried_lapsed_now') as carried_already_settled,
  (select count(*) from feed_subscriptions
     where server_registration_id is null and status <> 'lapsed'
       and (ends_at > now() or ends_at is null)) as fs_no_server_live,
  (select to_regclass('feed_subscriptions_license_feed_tier_live_uidx') is not null) as index_0081_present;

insert into schema_migrations (version, name) values
  ('0089', '0089_drop_server_or_lapsed_exception.sql')
on conflict (version) do nothing;

commit;
