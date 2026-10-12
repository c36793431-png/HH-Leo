-- Rollback for 0104_finance_ro_grants.sql. Not applied automatically.
-- Revokes only what 0104 granted. A table-level REVOKE also removes the column-level licenses grants. The role
-- itself is coxwell's: drop it in Neon if it should go too. Nothing in the app reads as finance_ro, so there is
-- no code to roll back first; FOC18's reads start failing with "permission denied".
begin;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'finance_ro') then
    revoke select on payments, referral_earnings, partner_deals, deal_payments, licenses, feed_subscriptions from finance_ro;
  end if;
end $$;
delete from schema_migrations where version = '0104';
commit;
