-- NOT RUN AUTOMATICALLY. 0091_rollback.sql -- companion to 0091_provider_tier_endpoints.sql,
-- thread provider-tier-endpoints-2026-09-24. Written by kai on kai/tier-endpoints-design-2026-09-24.
-- AFTER THE CODE MERGE (instant (ii) of the 0091 header) THE CODE REVERT COMES FIRST: revert
-- the code branch, wait for the deploy, then run this file (fable S2 via marcus m53845). The
-- live code reads and writes the two tables with no guards, so dropping them under it 500s the
-- admin pages and fails every confirm.
--
-- 0091 is additive: it creates two child tables and backfills them, and never writes the parent
-- columns. So this rollback is loss-free ONLY before instant (ii). After (ii) the dual-write
-- keeps the parent columns equal to the position-0 child, so position 0 is reproducible; every
-- row at position >= 1 and every non-null notes is not, and dropping the tables loses it. The
-- count check below refuses in that case; coxwell decides by hand.
--
-- One transaction. Dry-run with `rollback;` in place of `commit;` first.

begin;

do $$
declare
  extra int;
begin
  if not exists (select 1 from schema_migrations where version = '0091') then
    raise exception '0091 rollback: 0091 not in schema_migrations';
  end if;
  -- any child row the parent columns cannot reproduce = data that would be lost.
  select count(*) into extra from (
    select 1 from provider_tier_endpoints e
      join provider_tiers t on t.id = e.tier_id
     where e.position <> 0
        or e.protocol is distinct from t.protocol
        or e.endpoint_host is distinct from t.endpoint_host
        or e.endpoint_port is distinct from t.endpoint_port
        or e.compid is distinct from t.compid
        or e.endpoint_verified is distinct from t.endpoint_verified
        or e.notes is not null
    union all
    select 1 from provider_tier_proposal_endpoints e
      join provider_tier_proposals p on p.id = e.proposal_id
     where e.position <> 0
        or e.protocol is distinct from p.protocol
        or e.endpoint_host is distinct from p.endpoint_host
        or e.endpoint_port is distinct from p.endpoint_port
        or e.compid is distinct from p.compid
        or e.notes is not null
  ) x;
  if extra > 0 then
    raise exception '0091 rollback: % child rows the parent columns do not hold; dropping loses them', extra;
  end if;
  raise notice '0091 rollback: child rows not reproducible from parents: %', extra;
end $$;

drop table if exists provider_tier_endpoints;
drop table if exists provider_tier_proposal_endpoints;

delete from schema_migrations where version = '0091';

commit;
