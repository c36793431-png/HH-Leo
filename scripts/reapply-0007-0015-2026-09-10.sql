-- Re-apply 0007 and 0015 in full. FOR COXWELL, via marcus.
-- Thread: iris-black-trial-r2-ferry-2026-09-10 (migration drift item). Leo, 2026-09-10.
--
-- WHAT THIS IS NOT: this is not a schema_migrations backfill. No row here is
-- asserted on the strength of "we think it ran". Both files below are the real
-- migrations, pasted verbatim, and each ends with its own self-insert -- so the
-- ledger row gets written because the migration actually ran, now, in front of you.
--
-- WHY THEY ARE FLAGGED. The nightly drift check reports 0007 and 0015 as missing
-- ledger rows. Both files have carried their own
--   insert into schema_migrations ... on conflict (version) do nothing
-- since the commit that created them (0007: 18babf3, 2026-07-26; 0015: d57d7ff,
-- 2026-07-30 -- verified in git, the insert is in the creating diff, not added later).
-- So a complete paste of either file would have written its row. The row is absent.
-- The paste never reached the tail. This is the same failure mode as
-- 0054_tier_waitlist.sql (fixed by 0054a_backfill_migration_row.sql), and it is the
-- mirror image of the begin;/commit; hazard flagged for 0084: there the ledger gets
-- written and the object doesn't exist; here the work was done and the ledger wasn't
-- written. Both come from a paste that stopped partway with nothing to roll it back.
--
-- WHY RE-RUNNING IS SAFE -- MEASURED, NOT ASSUMED. Read-only check against prod,
-- 2026-09-10, running each migration's own selection logic verbatim:
--   0007  rows matching its UPDATE predicate (rn > 1): 0  -> update touches 0 rows
--   0015  alonzo%           : no matching active license -> 0 rows
--         sahilsahu202@...  : already tier='team' -> 0 rows, no value change
--         Wwwsss            : already tier='paid' -> 0 rows, no value change
--         jaymob123@...     : already tier='deal' -> 0 rows, no value change
-- Every statement below is a verified no-op on data as of this check. The only rows
-- this file creates are the two schema_migrations rows. Both migrations are also
-- idempotent by construction (see their own header comments).
--
-- The 2026-09-10 measurement is what makes the 0015 re-run safe, and it is the part
-- with a shelf life: if anyone changes one of those four licenses' tier via the
-- /admin/licenses dropdown between now and the paste, re-running 0015 would silently
-- revert it. Re-run the check immediately before pasting:
--   node scripts/verify-0007-0015-rerun-noop.mjs
-- It exits non-zero and says DO NOT PASTE if any of the four has drifted.
--
-- WRAPPED IN begin;/commit; DELIBERATELY. If any statement errors, the whole thing
-- rolls back and neither ledger row is written -- so a half-finished paste cannot
-- leave the ledger claiming more than actually ran. That is the protection this
-- file exists to demonstrate.
--
-- NOT INCLUDED, on purpose:
--   0077 -- genuinely never applied. users.referred_by_partner_id does not exist in
--           prod. That flag is TRUE and must keep firing until 0077 is applied for
--           real; it is not drift noise and it is not fixed by this file.
--   0083/0084 -- separate, in your own paste queue.

begin;

-- ===== 0007_dedupe_active_licenses.sql =====
with ranked as (
  select id, user_id,
         row_number() over (
           partition by user_id
           order by expires_at desc, issued_at desc
         ) as rn
  from licenses
  where status = 'active' and expires_at > now() and user_id is not null
)
update licenses
set status = 'revoked', lifecycle_state = 'expired_processed'
where id in (select id from ranked where rn > 1);

insert into schema_migrations (version, name) values
  ('0007', '0007_dedupe_active_licenses.sql')
on conflict (version) do nothing;

-- ===== 0015_license_tier_backfill.sql =====
update licenses set tier = 'trial'
where id = (
  select l.id from licenses l
  join users u on u.id = l.user_id
  where u.email ilike 'alonzo%' and l.status = 'active'
  order by l.expires_at desc
  limit 1
);

update licenses set tier = 'team'
where id = (
  select l.id from licenses l
  join users u on u.id = l.user_id
  where u.email = 'sahilsahu202@gmail.com' and l.status = 'active'
  order by l.expires_at desc
  limit 1
);

update licenses set tier = 'paid'
where id = (
  select l.id from licenses l
  join users u on u.id = l.user_id
  where (u.telegram_username = 'Wwwsss' or u.display_name = 'Wwwsss') and l.status = 'active'
  order by l.expires_at desc
  limit 1
);

update licenses set tier = 'deal'
where id = (
  select l.id from licenses l
  join users u on u.id = l.user_id
  where u.email = 'jaymob123@gmail.com' and l.status = 'active'
  order by l.expires_at desc
  limit 1
);

insert into schema_migrations (version, name) values
  ('0015', '0015_license_tier_backfill.sql')
on conflict (version) do nothing;

-- Pre-commit check. Expect exactly two rows, 0007 and 0015. If you see anything
-- else, roll back instead of committing.
select version, name from schema_migrations where version in ('0007','0015') order by version;

commit;

-- After committing, verify the data is unchanged -- not just that the ledger rows
-- appeared. Expect zero rows from the first query and the same four tiers below.
-- select count(*) from (
--   select user_id from licenses
--   where status = 'active' and expires_at > now() and user_id is not null
--   group by user_id having count(*) > 1
-- ) d;
-- select u.email, u.telegram_username, l.tier from licenses l join users u on u.id = l.user_id
--  where (u.email = 'sahilsahu202@gmail.com' or u.email = 'jaymob123@gmail.com'
--         or u.telegram_username = 'Wwwsss' or u.display_name = 'Wwwsss')
--    and l.status = 'active';
