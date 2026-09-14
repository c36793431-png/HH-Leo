-- Companion to 0089_drop_server_or_lapsed_exception.sql. NOT applied automatically; written in
-- the same commit so it exists before the transaction runs (0081 / 0086 / 0088 discipline).
-- Thread kai-tighten-0087-2026-09-12.
--
-- Reverses 0089 in the opposite order: the 0081 index back (preflight: zero live (license_id,
-- feed_tier_id) duplicate groups, else abort), the CHECK back with an exception RECOMPUTED from
-- the data (marcus m50350_mu0ztzip, 2026-09-14: no client list is written down anywhere in this
-- set of files), the '0089' ledger row deleted.
--
-- The original carried set is NOT recoverable and is not pretended to be: 0089 dropped the only
-- record of it (the constraint text) and then settled every row in it. What this file restores is
-- the 0088 step-5 SHAPE, rebuilt against the rows that need it NOW -- NULL-server non-lapsed rows
-- at rollback time, by `execute format`, exactly as 0088 step 5 builds it.
--
-- After a committed 0089 that set is EMPTY BY CONSTRUCTION, not merely empty in practice (fable
-- Z4, m50391_mu10l45h, 2026-09-14): 0089 leaves the CHECK in force with no exception, and it stays
-- in force until this file's own DROP a few lines below, in this same transaction. No row can be
-- non-lapsed with a NULL server while it holds, and nothing can insert one between the DROP and
-- the recompute. So the restored constraint is textually what 0089 left. The carrying branch is
-- kept as a GUARD, not as an expected path -- if it ever fires, the constraint was not in force
-- when this file ran (0089 rolled back already, applied outside a transaction, or the constraint
-- dropped by hand), and carrying those rows is then the only way the ADD CONSTRAINT can succeed
-- at all.
--
-- NOT reverted, stated up front (fable v1.76 via marcus m49852):
--   - 0089 step 1, the re-key of the carried rows: a 0086 column backfill, left as written,
--     exactly as 0088_rollback.sql treats 0088 step 4.
--   - 0089 step 3, the lapse of expired carried rows: stored 'lapsed' on a row whose ends_at is
--     past is truthful either way, exactly as 0088_rollback.sql keeps the step-5 lapse.
-- Both are consistent with the restored CHECK (a bound row passes on its server, a lapsed row on
-- its status), so the ADD CONSTRAINT below cannot fail on them.
--
-- Must run BEFORE 0088_rollback.sql if both are being reversed (0088_rollback refuses a '0089'
-- ledger row).

begin;

do $$
begin
  if not exists (select 1 from schema_migrations where version = '0089') then
    raise exception 'rollback 0089: schema_migrations has no 0089 row; nothing to roll back';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- 5 reverse: the 0081 index back (preflight: no live (license_id, feed_tier_id) duplicates)
-- ---------------------------------------------------------------------------------------

do $$
declare
  dup_groups integer;
begin
  select count(*) into dup_groups
  from (
    select license_id, feed_tier_id
    from feed_subscriptions
    where feed_tier_id is not null and status in ('trial', 'active')
    group by license_id, feed_tier_id
    having count(*) > 1
  ) d;
  if dup_groups != 0 then
    raise exception 'rollback 0089 step 5: % live (license_id, feed_tier_id) duplicate groups; the 0081 index cannot be recreated', dup_groups;
  end if;
  raise notice 'rollback 0089 step 5 preflight ok: live (license_id, feed_tier_id) duplicate groups=0';
end $$;

create unique index if not exists feed_subscriptions_license_feed_tier_live_uidx
  on feed_subscriptions (license_id, feed_tier_id)
  where feed_tier_id is not null and status in ('trial', 'active');

-- ---------------------------------------------------------------------------------------
-- 4 reverse: the CHECK back in the 0088 step-5 form, its exception recomputed from the data.
-- Steps 3 and 1: not reverted. After a committed 0089 the recomputed set is EMPTY BY CONSTRUCTION
-- (fable Z4, m50391_mu10l45h): the exception-less CHECK 0089 added is in force right up to the
-- DROP below, in this transaction, so no non-lapsed NULL-server row can exist to be found. The
-- constraint therefore comes back in its plain two-branch form and the notice says NO exception.
-- The carrying branch below is a guard against the constraint NOT having been in force (a 0089
-- already rolled back, or a hand-dropped constraint), not an expected outcome.
-- ---------------------------------------------------------------------------------------

alter table feed_subscriptions
  drop constraint if exists feed_subscriptions_server_or_lapsed_chk;

do $$
declare
  r record;
  ids text;
  carved integer;
begin
  create temp table tmp_0089_rb_carve_out on commit drop as
  select fs.id
  from feed_subscriptions fs
  where fs.server_registration_id is null and fs.status <> 'lapsed';

  select count(*) into carved from tmp_0089_rb_carve_out;
  for r in
    select fs.id, coalesce(u.email, u.display_name, fs.subscriber_user_id::text) as subscriber,
           fs.status, fs.ends_at
    from tmp_0089_rb_carve_out c
    join feed_subscriptions fs on fs.id = c.id
    left join users u on u.id = fs.subscriber_user_id
    order by subscriber, fs.id
  loop
    raise notice 'rollback 0089 step 4 carrying: id=% subscriber=% status=% ends_at=%',
      r.id, r.subscriber, r.status, r.ends_at;
  end loop;

  -- No ends_at predicate here, unlike 0088 step 5: a rollback must not also decide that an
  -- expired row may keep a NULL server. Every row that would fail the constraint is carried,
  -- named above, and left for a re-run of 0089 to settle. Expected count after a committed 0089:
  -- 0, by construction (see the header) -- the else branch is a guard, not a path.
  if carved = 0 then
    execute 'alter table feed_subscriptions'
         || ' add constraint feed_subscriptions_server_or_lapsed_chk'
         || ' check (status = ''lapsed'' or server_registration_id is not null)';
    raise notice 'rollback 0089 step 4 ok: CHECK restored with NO exception (nothing left non-lapsed with a NULL server)';
  else
    select string_agg(format('%L', c.id::text), ', ' order by c.id) into ids from tmp_0089_rb_carve_out c;
    execute format('alter table feed_subscriptions'
                || ' add constraint feed_subscriptions_server_or_lapsed_chk'
                || ' check (status = ''lapsed'' or server_registration_id is not null'
                || ' or id in (%s))', ids);
    raise notice 'rollback 0089 step 4 ok: CHECK restored carrying % id(s), listed above', carved;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- ledger
-- ---------------------------------------------------------------------------------------

delete from schema_migrations where version = '0089';

commit;
