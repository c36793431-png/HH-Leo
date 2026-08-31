-- Bug 1 (marcus, thread overnight-builds-2026-08-30): sendGroupInvite unconditionally
-- inserted a new group_memberships row on every call, so a renewal or a manual resend
-- (resendGroupInviteAction) piled up duplicate rows for a user already invited/joined.
-- Fixed at the source with a partial unique index + upsert (see src/lib/group-membership.ts)
-- rather than per-caller — "removed_on_lapse"/"left" rows are excluded so a genuine rejoin
-- after removal still gets a fresh row.
--
-- Split from the original 0073 draft on marcus's hold (thread overnight-builds-2026-08-30,
-- 2026-08-31): this file only creates the index. Any dedup of pre-existing duplicate rows
-- happens in 0073a, and only if db/migrations/0073a_check_group_memberships_dupes.sql
-- (read-only) finds rows to dedup.
create unique index if not exists group_memberships_active_user_chat_idx
  on group_memberships (user_id, chat_id)
  where status not in ('removed_on_lapse', 'left');

insert into schema_migrations (version, name)
select '0073', '0073_group_memberships_idempotent.sql'
where not exists (select 1 from schema_migrations where version = '0073');
