-- ============================================================================
-- Merge coxwell's duplicate account into his current login
-- ============================================================================
--
-- WHAT: coxwell has two rows in `users` for the same person. His CURRENT
--   login (the one he actually signs in with day to day) has zero rows in
--   `licenses`. A separate, stale account -- left over from earlier seed
--   data -- holds his one active license, and possibly other history
--   (admin actions, group membership, telegram identity) that belongs on
--   the current account instead.
--
-- WHY: /account and /downloads read license/entitlement state off the
--   *current session's* user_id. As long as the active license is attached
--   to the stale row, the account he actually logs into looks unpaid, even
--   though he's entitled. Moving the license (and any other cross-account
--   rows) onto the current user id and deleting the stale row fixes that
--   permanently instead of needing a one-off admin override.
--
-- HOW TO RUN (Neon dashboard SQL editor):
--   1. Run the STEP 0 SELECTs below (read-only, no writes) to find the two
--      user ids by email, and to sanity-check what will move.
--   2. Fill in every <PLACEHOLDER> in this script with the real values from
--      step 0's output. Do NOT run the placeholders as-is.
--   3. Run from BEGIN through the verification SELECTs at the bottom, all
--      in the same SQL editor tab/transaction.
--   4. Read the verification SELECT output. If it matches the "expected"
--      comment next to each query, run COMMIT. If anything looks wrong,
--      run ROLLBACK instead -- nothing is persisted until COMMIT runs.
--
-- ============================================================================
-- STEP 0 -- read-only preview. Safe to run anytime, makes no writes.
-- ============================================================================

-- Find the two account ids by email. Fill in the real email address(es)
-- below -- if both accounts share one email, this returns both rows; if the
-- stale account used a different/old email, run it twice with each address.
select id, email, telegram_user_id, telegram_username, telegram_bot_started_at,
       role, created_at
from users
where email in ('<STALE_EMAIL>', '<CURRENT_EMAIL>')
order by created_at;

-- Once you have the two ids from above, use them to preview what will move.
-- select id, status, expires_at, issued_by from licenses where user_id in ('<STALE_USER_ID>', '<CURRENT_USER_ID>');
-- select id, chat_id, status, joined_at from group_memberships where user_id in ('<STALE_USER_ID>', '<CURRENT_USER_ID>');
-- select id, action_type, admin_user_id, target_user_id from admin_actions where admin_user_id in ('<STALE_USER_ID>', '<CURRENT_USER_ID>') or target_user_id in ('<STALE_USER_ID>', '<CURRENT_USER_ID>');
-- select id, uploaded_by from downloads where uploaded_by in ('<STALE_USER_ID>', '<CURRENT_USER_ID>');

-- ============================================================================
-- STEP 1 -- fill in these placeholders everywhere they appear below, then
-- run STEP 2 onward as one transaction.
--   <STALE_USER_ID>                the seed-data account holding the license
--   <CURRENT_USER_ID>               the account coxwell actually logs into
--   <STALE_TELEGRAM_USER_ID>        stale row's telegram_user_id value (or NULL if it has none)
--   <STALE_TELEGRAM_USERNAME>       stale row's telegram_username value, quoted (or NULL)
--   <STALE_TELEGRAM_BOT_STARTED_AT> stale row's telegram_bot_started_at value, quoted timestamptz (or NULL)
-- (copy these straight out of the STEP 0 output -- don't guess)
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- licenses: move the license(s) onto the current account.
-- Product rule is one active license per user (see src/lib/licenses.ts,
-- DuplicateActiveLicenseError) -- since the current account has zero
-- licenses today, this can't create a second active license. If that
-- assumption is wrong (current account picked up a license since this
-- script was written), this update still runs but the app will start
-- rejecting new license issuance for this user until one is revoked --
-- check licenses.status for the current account in STEP 0 first.
-- ----------------------------------------------------------------------------
update licenses
set user_id = '<CURRENT_USER_ID>'
where user_id = '<STALE_USER_ID>';

-- licenses.issued_by is a self/admin-issuance reference, not an ownership
-- reference, and has no ON DELETE action -- it would block the DELETE FROM
-- users below if any license (issued by either account) points at the
-- stale id. Repoint those references too.
update licenses
set issued_by = '<CURRENT_USER_ID>'
where issued_by = '<STALE_USER_ID>';

-- ----------------------------------------------------------------------------
-- group_memberships: merge instead of blindly moving, in case the current
-- account already has its own row for the same paid Telegram group. Keep
-- the row with the earlier joined_at (an actual join beats a still-pending
-- invite; between two joins, the earlier one is the "real" membership
-- start date) and drop the other side's duplicate for that chat_id.
-- ----------------------------------------------------------------------------

-- current account's row is the better one (joined earlier, or stale side
-- never joined) -- drop the stale-side duplicate for that chat.
delete from group_memberships gm_stale
using group_memberships gm_current
where gm_stale.user_id = '<STALE_USER_ID>'
  and gm_current.user_id = '<CURRENT_USER_ID>'
  and gm_stale.chat_id = gm_current.chat_id
  and coalesce(gm_current.joined_at, 'infinity'::timestamptz)
      <= coalesce(gm_stale.joined_at, 'infinity'::timestamptz);

-- stale account's row is the better one -- drop the current-side duplicate
-- for that chat, so the reassignment below doesn't leave two rows.
delete from group_memberships gm_current
using group_memberships gm_stale
where gm_current.user_id = '<CURRENT_USER_ID>'
  and gm_stale.user_id = '<STALE_USER_ID>'
  and gm_current.chat_id = gm_stale.chat_id
  and coalesce(gm_stale.joined_at, 'infinity'::timestamptz)
      < coalesce(gm_current.joined_at, 'infinity'::timestamptz);

-- whatever's left on the stale account (no more chat_id collisions with
-- current) can now move over directly.
update group_memberships
set user_id = '<CURRENT_USER_ID>'
where user_id = '<STALE_USER_ID>';

-- ----------------------------------------------------------------------------
-- admin_actions: audit trail references. No ON DELETE action, so these
-- would also block the DELETE FROM users below if left pointing at stale.
-- Repoint rather than delete -- this is history, not live state.
-- ----------------------------------------------------------------------------
update admin_actions
set admin_user_id = '<CURRENT_USER_ID>'
where admin_user_id = '<STALE_USER_ID>';

update admin_actions
set target_user_id = '<CURRENT_USER_ID>'
where target_user_id = '<STALE_USER_ID>';

-- ----------------------------------------------------------------------------
-- downloads: uploaded_by attribution (only relevant if the stale account
-- ever had admin/publish rights). No ON DELETE action -- same reasoning.
-- ----------------------------------------------------------------------------
update downloads
set uploaded_by = '<CURRENT_USER_ID>'
where uploaded_by = '<STALE_USER_ID>';

-- ----------------------------------------------------------------------------
-- telegram identity on users: move the real linked Telegram identity from
-- the stale row onto the current row. telegram_user_id is UNIQUE, so the
-- stale row must be cleared first to free the value before the current
-- row can take it -- otherwise this errors with a unique violation.
-- ----------------------------------------------------------------------------
update users
set telegram_user_id = null,
    telegram_username = null,
    telegram_bot_started_at = null
where id = '<STALE_USER_ID>';

update users
set telegram_user_id = <STALE_TELEGRAM_USER_ID>,
    telegram_username = <STALE_TELEGRAM_USERNAME>,
    telegram_bot_started_at = <STALE_TELEGRAM_BOT_STARTED_AT>
where id = '<CURRENT_USER_ID>';

-- ----------------------------------------------------------------------------
-- Not migrated, intentionally -- these all reference users(id) with
-- ON DELETE CASCADE, so they clean themselves up when the stale row is
-- deleted below. They're session/auth artifacts tied to *how* the stale
-- account logged in, not business data worth preserving:
--   accounts (OAuth/credentials provider links for the stale row)
--   sessions (any live session tokens for the stale row)
--   signin_events (historical sign-in log for the stale row)
--   telegram_onboarding_tokens (onboarding deep-link tokens for the stale row)
-- There is no invoices/billing table in this schema (checked db/migrations/
-- 0001-0009) -- licenses is the only monetary/entitlement record.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Finally, remove the stale account. This should now succeed cleanly --
-- every FK without an ON DELETE action has been repointed above.
-- ----------------------------------------------------------------------------
delete from users where id = '<STALE_USER_ID>';

-- ============================================================================
-- VERIFICATION -- read the output before deciding COMMIT vs ROLLBACK.
-- ============================================================================

-- expected: exactly 1 row, status = 'active'
select id, status, expires_at
from licenses
where user_id = '<CURRENT_USER_ID>' and status = 'active';

-- expected: exactly 1 row with status = 'joined'
select id, chat_id, status, joined_at
from group_memberships
where user_id = '<CURRENT_USER_ID>' and status = 'joined';

-- expected: 1 row, telegram_user_id is the real id moved from the stale
-- account, and is NOT the placeholder/dummy value 999888777
select id, telegram_user_id, telegram_username
from users
where id = '<CURRENT_USER_ID>';

-- expected: 0 rows -- stale account is gone
select id from users where id = '<STALE_USER_ID>';

-- ============================================================================
-- If everything above matches:  commit;
-- If anything looks wrong:      rollback;
-- ============================================================================
