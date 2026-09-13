-- Companion to 0089_drop_server_or_lapsed_exception.sql. NOT applied automatically; written in
-- the same commit so it exists before the transaction runs (0081 / 0086 / 0088 discipline).
-- Thread kai-tighten-0087-2026-09-12.
--
-- Reverses 0089 in the opposite order: the 0081 index back (preflight: zero live (license_id,
-- feed_tier_id) duplicate groups, else abort), the CHECK back WITH the six-id exception (same
-- list as 0089 step 1; fill in the same uuids), the '0089' ledger row deleted. Nothing lossy:
-- 0089 writes no rows.
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
-- 3 reverse: the 0081 index back (preflight: no live (license_id, feed_tier_id) duplicates)
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
    raise exception 'rollback 0089 step 3: % live (license_id, feed_tier_id) duplicate groups; the 0081 index cannot be recreated', dup_groups;
  end if;
  raise notice 'rollback 0089 step 3 preflight ok: live (license_id, feed_tier_id) duplicate groups=0';
end $$;

create unique index if not exists feed_subscriptions_license_feed_tier_live_uidx
  on feed_subscriptions (license_id, feed_tier_id)
  where feed_tier_id is not null and status in ('trial', 'active');

-- ---------------------------------------------------------------------------------------
-- 2 reverse: the CHECK back with the exception (0088 step 5 form)
-- ---------------------------------------------------------------------------------------

alter table feed_subscriptions
  drop constraint if exists feed_subscriptions_server_or_lapsed_chk;

alter table feed_subscriptions
  add constraint feed_subscriptions_server_or_lapsed_chk
  check (status = 'lapsed' or server_registration_id is not null
         or id in ('82147257-FILL-IN-FULL-UUID',
                   '4a0a7fb8-FILL-IN-FULL-UUID',
                   '00f9e32c-FILL-IN-FULL-UUID',
                   'a453d4c0-FILL-IN-FULL-UUID',
                   '2e7ad400-FILL-IN-FULL-UUID',
                   '1161625a-FILL-IN-FULL-UUID'));

-- ---------------------------------------------------------------------------------------
-- ledger
-- ---------------------------------------------------------------------------------------

delete from schema_migrations where version = '0089';

commit;
