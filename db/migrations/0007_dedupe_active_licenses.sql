-- 0007: one-time cleanup for the "unlimited concurrent active licenses" bug (Bug 5).
--
-- Product rule going forward is one active license per user at a time, enforced in
-- app code by issueLicense() (src/lib/licenses.ts). This migration cleans up
-- pre-existing duplicates: for any user with more than one active license, keep
-- the one with the furthest-out expiry (ties broken by most recently issued) and
-- revoke the rest.
--
-- Idempotent: after the first run no user has >1 active license, so re-running
-- the update touches zero rows.

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
