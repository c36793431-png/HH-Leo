-- Rollback for 0107_bundle_subscriptions.sql. Not applied automatically.
-- Roll the CODE back first: plain assign reads feed_subscriptions.bundle_subscription_id and revokeLicense
-- writes licenses.revoked_at.
-- Refuses while any bundle_subscriptions row or any 'bundle' payment exists: that is a sale and money received,
-- and deleting or re-tagging it is a decision for whoever owns the ledger.
-- Refuses unless payments_category_check holds EXACTLY the value set this file's forward created (a value-set
-- compare of the quoted literals, not a byte compare: pg_get_constraintdef renders `= ANY (ARRAY[...::text])`,
-- fold m67030 S3). So it refuses after 0108 has added 'nova' (roll 0108 back first), and it refuses when the
-- constraint is absent (the literal set is then empty).
-- HAZARD: dropping licenses.revoked_at loses WHEN each licence was revoked since 0107; status stays 'revoked'.
begin;
do $$
declare
  found text[];
begin
  if exists (select 1 from bundle_subscriptions) then
    raise exception '0107 rollback: bundle_subscriptions has rows; end and remove them by hand first';
  end if;
  if exists (select 1 from payments where category = 'bundle') then
    raise exception '0107 rollback: payments has bundle rows; re-tag or remove them first';
  end if;
  found := array(
    select m[1]
    from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g') m
    where c.conname = 'payments_category_check' and c.conrelid = 'payments'::regclass
    order by 1
  );
  if found is distinct from array['affiliate', 'bundle', 'customer', 'feed_access', 'feed_provider', 'infra', 'other', 'partner', 'referral_payout']::text[] then
    raise exception '0107 rollback: payments_category_check is not the set 0107 created (found %); roll back the later migration first', found;
  end if;
end $$;
alter table payments drop constraint payments_category_check;
alter table payments add constraint payments_category_check
  check (category in ('customer', 'partner', 'affiliate', 'feed_provider', 'infra', 'other', 'referral_payout', 'feed_access'));
drop index if exists payments_bundle_subscription_id_idx;
alter table payments drop column if exists bundle_subscription_id;
drop index if exists feed_subscriptions_bundle_subscription_id_idx;
alter table feed_subscriptions drop column if exists bundle_subscription_id;
alter table licenses drop column if exists revoked_at;
drop table if exists bundle_subscriptions;
delete from schema_migrations where version = '0107';
commit;
