-- Companion to 0089_drop_server_or_lapsed_exception.sql. NOT applied automatically; written in
-- the same commit so it exists before the transaction runs (0081 / 0086 / 0088 discipline).
-- Thread kai-tighten-0087-2026-09-12.
--
-- Reverses 0089 in the opposite order: the 0081 index back (preflight: zero live (license_id,
-- feed_tier_id) duplicate groups, else abort), the CHECK back WITH the six-id exception (same
-- list as 0089 step 0, committed from marcus m49945_mtzxrd14), the '0089' ledger row deleted.
--
-- NOT reverted, stated up front (fable v1.76 via marcus m49852):
--   - 0089 step 1, the re-key of the six: a 0086 column backfill, left as written, exactly as
--     0088_rollback.sql treats 0088 step 4.
--   - 0089 step 3, the lapse of expired exempt rows: stored 'lapsed' on a row whose ends_at is
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
-- 4 reverse: the CHECK back with the exception (0088 step 5 form). Steps 3 and 1: not reverted.
-- ---------------------------------------------------------------------------------------

alter table feed_subscriptions
  drop constraint if exists feed_subscriptions_server_or_lapsed_chk;

alter table feed_subscriptions
  add constraint feed_subscriptions_server_or_lapsed_chk
  check (status = 'lapsed' or server_registration_id is not null
         or id in ('82147257-d90b-4ed9-a12e-68adeaf0b2d4',
                   '4a0a7fb8-0ac2-49f4-b7a8-4007a7c92500',
                   '00f9e32c-70e8-46f6-a74c-43317edf62c5',
                   'a453d4c0-fcb0-4643-a244-ad6e14273164',
                   '2e7ad400-9c26-440c-af09-44db1aa8d254',
                   '1161625a-72bb-4472-9282-16062f0cad13'));

-- ---------------------------------------------------------------------------------------
-- ledger
-- ---------------------------------------------------------------------------------------

delete from schema_migrations where version = '0089';

commit;
