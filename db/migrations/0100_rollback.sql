-- Rollback for 0100_payments_feed_access.sql. Not applied automatically.
-- Roll the CODE back first: the admin queue's paid approve writes category 'feed_access' and access_request_id.
-- Refuses while any 'feed_access' row exists: that is money received, and re-tagging or deleting it is a decision
-- for whoever owns the ledger, not something a rollback does silently. Re-tag or remove those rows by hand first.
begin;
do $$
begin
  if exists (select 1 from payments where category = 'feed_access') then
    raise exception '0100 rollback: payments has feed_access rows; re-tag or remove them first';
  end if;
end $$;
drop index if exists payments_access_request_id_idx;
alter table payments drop column if exists access_request_id;
alter table payments drop constraint payments_category_check;
alter table payments add constraint payments_category_check
  check (category in ('customer', 'partner', 'affiliate', 'feed_provider', 'infra', 'other', 'referral_payout'));
delete from schema_migrations where version = '0100';
commit;
