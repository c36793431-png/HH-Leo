-- Partner-role backfill (bus thread user-roles-migration-2026-09-01, marcus
-- authorized 2026-09-01 after m34230/m34235). Targeted repair for the one gap
-- found when scoping 0075's backfill against every provider/partner source
-- table across all 31 users: an account can hold an active `partners` row and
-- an approved `partner_applications` row -- real evidence it was granted
-- 'partner' -- with no matching row in `user_roles`, because that grant was
-- silently overwritten by a later feed_provider onboarding before 0075 ran.
-- 0075 step 1 could only capture the *current* users.role at backfill time,
-- and steps 2/3 only recovered from licences and the hardcoded admin email,
-- never from partners/partner_applications.
--
-- Checked class-wide, not assumed: feed_provider has 0 gaps against both
-- feed_tiers ownership and approved provider_applications. partner has
-- exactly 1 gap against these two source tables, confirmed by both
-- independently naming the same user_id (94529d89-ae75-4df5-a15f-1f8a004509d1,
-- c36793431@gmail.com). Expected result of the insert below: INSERT 0 1.
-- Postgres reports rows matched by the query, not rows that differ from what
-- was already there -- since this is the only account in the join today, that
-- also means rows changed. If it comes back as anything other than 1, the
-- source population has changed since this was scoped and it should not be
-- assumed correct -- stop and report back before treating it as done.
--
-- Sourced from a join, not a hardcoded user_id literal, so the query itself is
-- the evidence for who qualifies: an active partners row and an approved
-- partner_applications row naming the same user_id. granted_by is the admin
-- who actually reviewed the application (partner_applications.reviewed_by),
-- the real granter, unlike 0075's necessarily-null backfilled rows.

insert into user_roles (user_id, role, granted_by)
select distinct p.user_id, 'partner', pa.reviewed_by
from partners p
join partner_applications pa on pa.user_id = p.user_id
where p.status = 'active'
  and pa.status = 'approved'
  and p.user_id is not null
on conflict (user_id, role) do nothing;

-- Verification: should be exactly one row, the same account named above.
select user_id, role, granted_at, granted_by
from user_roles
where role = 'partner'
  and user_id in (
    select p.user_id
    from partners p
    join partner_applications pa on pa.user_id = p.user_id
    where p.status = 'active' and pa.status = 'approved' and p.user_id is not null
  );

insert into schema_migrations (version, name) values
  ('0076', '0076_partner_role_backfill.sql')
on conflict (version) do nothing;
