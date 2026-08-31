-- Apply ONLY if the read-only count query below returns rows. If it returns zero rows,
-- 0073's unique index applies cleanly on its own and this file should be deleted, not run.
--
-- Read-only check (run this first, hand the result to marcus/coxwell before applying
-- anything below — matches the 0073 index predicate exactly, so a zero result is real
-- evidence the index will create cleanly):
--
--   select user_id, chat_id, count(*)
--   from group_memberships
--   where status not in ('removed_on_lapse', 'left')
--   group by user_id, chat_id
--   having count(*) > 1;
--
-- Dedup: mark all but the most-recently-invited active-status row per (user_id, chat_id)
-- as 'left', so 0073's unique index can be created against rows that already contain
-- duplicates from before that fix.
--
-- Apply order note (2026-08-31): the "0073a" suffix does not mean "after 0073" here —
-- this UPDATE must run BEFORE 0073's create unique index, whenever duplicates exist,
-- or that index creation fails on the still-present dupes.
update group_memberships gm
set status = 'left', removed_at = coalesce(removed_at, now())
where status not in ('removed_on_lapse', 'left')
  and exists (
    select 1 from group_memberships newer
    where newer.user_id = gm.user_id
      and newer.chat_id = gm.chat_id
      and newer.status not in ('removed_on_lapse', 'left')
      and (coalesce(newer.joined_at, newer.invited_at), newer.id)
        > (coalesce(gm.joined_at, gm.invited_at), gm.id)
  );

insert into schema_migrations (version, name)
select '0073a', '0073a_group_memberships_dedup.sql'
where not exists (select 1 from schema_migrations where version = '0073a');
