-- finance_ro: read-only grants for FOC18, the ATLAS finance agent (marcus m65035). GRANT-only, additive.
-- The role is coxwell's to create, never this file's: the repo is public, so no CREATE ROLE and no password here.
-- Guards. Each one raises a NOTICE, grants nothing and does NOT write the schema_migrations row, so the drift
-- check keeps naming 0104 until a re-run lands it:
--   1. finance_ro does not exist.
--   2. finance_ro is SUPERUSER or BYPASSRLS, or a member of neon_superuser, neondb_owner (owner = full rights),
--      pg_read_all_data or pg_write_all_data
--      (direct or through another role). On this database neon_superuser is itself a member of pg_read_all_data
--      AND pg_write_all_data, so such a role already reads and writes every table, users included, and these
--      grants would not be its boundary.
-- licenses is granted by column: everything except license_key and hardware_id (credentials) and claim_email and
-- claim_telegram_user_id (contact details, which the no-users-table rule keeps out). A column added to licenses
-- later is NOT readable until granted. No users table, no default privileges, no schema grant: PUBLIC already
-- holds USAGE on schema public.
-- Rollback: 0104_rollback.sql.
do $$
declare
  v_oid oid;
  v_super boolean;
  v_bypassrls boolean;
  v_wide text;
begin
  select oid, rolsuper, rolbypassrls into v_oid, v_super, v_bypassrls from pg_roles where rolname = 'finance_ro';
  if v_oid is null then
    raise notice '0104 skipped: role finance_ro does not exist. Nothing granted, schema_migrations not written.';
    return;
  end if;
  if v_super or v_bypassrls then
    raise notice '0104 skipped: finance_ro is SUPERUSER or BYPASSRLS. Nothing granted, schema_migrations not written.';
    return;
  end if;
  select string_agg(g.rolname, ', ' order by g.rolname) into v_wide
    from pg_roles g
   where g.rolname in ('neon_superuser', 'neondb_owner', 'pg_read_all_data', 'pg_write_all_data')
     and pg_has_role(v_oid, g.oid, 'MEMBER');
  if v_wide is not null then
    raise notice '0104 skipped: finance_ro is a member of % and can already read and write every table. Nothing granted, schema_migrations not written.', v_wide;
    return;
  end if;

  grant select on payments, referral_earnings, partner_deals, deal_payments, feed_subscriptions to finance_ro;
  grant select (id, user_id, status, issued_at, expires_at, last_verified_at, lifecycle_state, notes, tier, issued_by,
    activated_at, feed_types, hardware_bound_at) on licenses to finance_ro;

  insert into schema_migrations (version, name) values
    ('0104', '0104_finance_ro_grants.sql')
  on conflict (version) do nothing;
  raise notice '0104 applied: SELECT on 5 tables + 13 licenses columns granted to finance_ro.';
end $$;
