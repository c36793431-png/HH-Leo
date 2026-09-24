-- NOT RUN AUTOMATICALLY. 0090_rollback.sql -- companion to 0090_provider_tier_endpoints.sql,
-- thread provider-tier-endpoints-2026-09-24. Written by kai on kai/tier-endpoints-design-2026-09-24.
--
-- 0090 is additive: it creates two child tables and backfills them, and never writes the parent
-- columns. So this rollback is loss-free ONLY before instant (ii) of the 0090 header (the code
-- deploy that starts writing the child tables). After (ii) the child tables hold endpoint rows
-- the parent columns never had (every position >= 1, and any position 0 written by new code),
-- and dropping them loses data. The count check below refuses in that case; override by hand.
--
-- One transaction. Dry-run with `rollback;` in place of `commit;` first.

begin;

do $$
declare
  extra int;
begin
  if not exists (select 1 from schema_migrations where version = '0090') then
    raise exception '0090 rollback: 0090 not in schema_migrations';
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
    raise exception '0090 rollback: % child rows the parent columns do not hold; dropping loses them', extra;
  end if;
  raise notice '0090 rollback: child rows not reproducible from parents: %', extra;
end $$;

drop table if exists provider_tier_endpoints;
drop table if exists provider_tier_proposal_endpoints;

delete from schema_migrations where version = '0090';

commit;
