-- Read-only. Safe to run against prod at any time — no mutation.
-- Matches the group_memberships_active_user_chat_idx predicate in 0073 exactly, so a
-- zero-row result is real evidence that index will create cleanly with no dedup needed.
-- Non-zero rows are the duplicates 0073a_group_memberships_dedup.sql would resolve —
-- look at them before running that file.
select user_id, chat_id, count(*)
from group_memberships
where status not in ('removed_on_lapse', 'left')
group by user_id, chat_id
having count(*) > 1;
