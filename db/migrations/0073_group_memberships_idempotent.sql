-- Bug 1 (marcus, thread overnight-builds-2026-08-30): sendGroupInvite unconditionally
-- inserted a new group_memberships row on every call, so a renewal or a manual resend
-- (resendGroupInviteAction) piled up duplicate rows for a user already invited/joined.
-- Fixed at the source with a partial unique index + upsert (see src/lib/group-membership.ts)
-- rather than per-caller — "removed_on_lapse"/"left" rows are excluded so a genuine rejoin
-- after removal still gets a fresh row.
--
-- Dedup first: mark all but the most-recently-invited active-status row per (user_id,
-- chat_id) as 'left', so the unique index below can be created against rows that may
-- already contain duplicates from before this fix.
update group_memberships gm
set status = 'left', removed_at = coalesce(removed_at, now())
where status not in ('removed_on_lapse', 'left')
  and exists (
    select 1 from group_memberships newer
    where newer.user_id = gm.user_id
      and newer.chat_id = gm.chat_id
      and newer.status not in ('removed_on_lapse', 'left')
      and (newer.invited_at, newer.id) > (gm.invited_at, gm.id)
  );

create unique index if not exists group_memberships_active_user_chat_idx
  on group_memberships (user_id, chat_id)
  where status not in ('removed_on_lapse', 'left');

insert into schema_migrations (version, name)
select '0073', '0073_group_memberships_idempotent.sql'
where not exists (select 1 from schema_migrations where version = '0073');
