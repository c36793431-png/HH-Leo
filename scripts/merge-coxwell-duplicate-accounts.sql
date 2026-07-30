-- ============================================================================
-- Merge coxwell's duplicate account into his current login
-- ============================================================================
--
-- REVISED 2026-07-30 based on o5's actual Neon findings. The original
-- version of this script had the roles backwards -- it assumed the account
-- holding the license was "stale" and the account coxwell logs into had
-- zero licenses. The real state is the opposite, and messier:
--
-- Account A (94529d89-ae75-4df5-a15f-1f8a004509d1)
--   -- coxwell's LOGIN account (email c36793431@gmail.com, his real license)
--   email: c36793431@gmail.com
--   telegram_user_id: 999888777        <- placeholder/seed value, WRONG
--   telegram_username: NULL
--   6 licenses: 5 marked 'active' (only 1 is genuinely unexpired, ending
--     2026-08-03 -- the other 4 are past expires_at but never had their
--     status flipped), 1 'revoked'
--   0 group_memberships
--
-- Account B (76c3de48-2650-4dab-b47b-a7dfa66b4698)
--   -- orphan account created by the Telegram linking flow, never logged
--   -- into via email/password
--   email: NULL
--   telegram_user_id: 7225949234       <- coxwell's REAL telegram id
--   telegram_username: 'Coxwell2'      <- real
--   0 licenses
--   1 group_memberships row (chat -1004469258486, status 'joined')
--
-- WHAT THIS SCRIPT DOES:
--   1. Fixes license status hygiene on A first (5 "active" -> 1 active,
--      4 marked as lapsed). Coxwell's call was to transition these to
--      'expired' rather than 'revoked', since they just aged out instead
--      of being admin-terminated -- but licenses.status has a CHECK
--      constraint of ('active', 'revoked') only (db/migrations/0001_init.sql)
--      and no 'expired' value exists, so setting status = 'expired' would
--      fail outright. This script instead follows the precedent already in
--      this schema for the identical situation (db/migrations/0007_dedupe_
--      active_licenses.sql): status = 'revoked', lifecycle_state =
--      'expired_processed'. That preserves the "lapsed, not admin-revoked"
--      distinction Coxwell wanted, just in the lifecycle_state column
--      instead of status. Flagged to marcus for confirmation.
--   2. Moves B's real Telegram identity onto A, after clearing it from B
--      first (telegram_user_id is UNIQUE across users, so both values
--      can't exist at once -- clear-then-set, in a single statement via a
--      CTE so the pre-clear telegram_bot_started_at value carries over
--      without anyone having to hand-copy it from a SELECT).
--   3. Moves B's group_memberships row onto A (no conflict -- A has none).
--   4. Repoints any other FKs from B to A defensively (expected empty for
--      an orphan account, but cheap to run and required before DELETE).
--   5. Deletes B. Everything else FK'd to users(id) with ON DELETE CASCADE
--      (accounts, sessions, signin_events, telegram_onboarding_tokens)
--      cleans itself up.
--
-- HOW TO RUN (Neon dashboard SQL editor):
--   1. Optionally run the STEP 0 SELECTs to reconfirm current state before
--      making changes -- the numbers above are what o5 verified as of
--      2026-07-30 and could drift if anything else touches these rows.
--   2. Run from BEGIN through the verification SELECTs at the bottom, all
--      in the same SQL editor tab/transaction.
--   3. Read the verification SELECT output. If it matches the "expected"
--      comment next to each query, run COMMIT. If anything looks wrong,
--      run ROLLBACK instead -- nothing is persisted until COMMIT runs.
--
-- ============================================================================
-- STEP 0 -- read-only preview. Safe to run anytime, makes no writes.
-- ============================================================================

select id, email, telegram_user_id, telegram_username, telegram_bot_started_at,
       role, created_at
from users
where id in ('94529d89-ae75-4df5-a15f-1f8a004509d1', '76c3de48-2650-4dab-b47b-a7dfa66b4698')
order by created_at;

select id, status, expires_at, issued_by
from licenses
where user_id in ('94529d89-ae75-4df5-a15f-1f8a004509d1', '76c3de48-2650-4dab-b47b-a7dfa66b4698')
order by expires_at;

select id, chat_id, status, joined_at
from group_memberships
where user_id in ('94529d89-ae75-4df5-a15f-1f8a004509d1', '76c3de48-2650-4dab-b47b-a7dfa66b4698');

select id, action_type, admin_user_id, target_user_id
from admin_actions
where admin_user_id in ('94529d89-ae75-4df5-a15f-1f8a004509d1', '76c3de48-2650-4dab-b47b-a7dfa66b4698')
   or target_user_id in ('94529d89-ae75-4df5-a15f-1f8a004509d1', '76c3de48-2650-4dab-b47b-a7dfa66b4698');

select id, uploaded_by
from downloads
where uploaded_by in ('94529d89-ae75-4df5-a15f-1f8a004509d1', '76c3de48-2650-4dab-b47b-a7dfa66b4698');

-- ============================================================================
-- STEP 1 -- the merge, as one transaction.
--   A = 94529d89-ae75-4df5-a15f-1f8a004509d1  (login account, kept)
--   B = 76c3de48-2650-4dab-b47b-a7dfa66b4698  (orphan, deleted at the end)
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- license hygiene on A, first: 4 of the 5 "active" rows are past their
-- expires_at and were never flipped. Fix that before anything else so
-- downstream checks (and the verification block below) see the real state
-- -- exactly 1 active license, the one that actually still runs (ending
-- 2026-08-03). Coxwell's call was 'expired' not 'revoked' since these
-- lapsed on their own rather than being admin-terminated -- but status has
-- no 'expired' value in its CHECK constraint (active/revoked only), so
-- this follows the existing 0007 migration's precedent for the same
-- situation: status = 'revoked' + lifecycle_state = 'expired_processed'.
-- ----------------------------------------------------------------------------
update licenses
set status = 'revoked',
    lifecycle_state = 'expired_processed'
where user_id = '94529d89-ae75-4df5-a15f-1f8a004509d1'
  and status = 'active'
  and expires_at <= now();

-- ----------------------------------------------------------------------------
-- telegram identity: move B's real linked identity onto A. B must be
-- cleared first since telegram_user_id is UNIQUE -- done here as a single
-- statement (clear-and-capture via CTE, then set) so the pre-clear
-- telegram_bot_started_at value flows straight from B to A without needing
-- to be read out and hand-pasted from a separate SELECT.
-- ----------------------------------------------------------------------------
with cleared as (
  update users
  set telegram_user_id = null,
      telegram_username = null,
      telegram_bot_started_at = null
  where id = '76c3de48-2650-4dab-b47b-a7dfa66b4698'
  returning telegram_bot_started_at
)
update users
set telegram_user_id = 7225949234,
    telegram_username = 'Coxwell2',
    telegram_bot_started_at = (select telegram_bot_started_at from cleared)
where id = '94529d89-ae75-4df5-a15f-1f8a004509d1';

-- ----------------------------------------------------------------------------
-- group_memberships: A has zero rows today, so this is a plain move, no
-- dedup needed. B's one row (chat -1004469258486, status 'joined') lands
-- on A.
-- ----------------------------------------------------------------------------
update group_memberships
set user_id = '94529d89-ae75-4df5-a15f-1f8a004509d1'
where user_id = '76c3de48-2650-4dab-b47b-a7dfa66b4698';

-- ----------------------------------------------------------------------------
-- defensive FK repoints -- B is an orphan account with 0 licenses, so these
-- are expected to affect 0 rows, but they have no ON DELETE action and
-- would block the DELETE FROM users below if B ever touched any of them
-- (e.g. as an admin actor, an uploader, or a license issuer).
-- ----------------------------------------------------------------------------
update licenses
set issued_by = '94529d89-ae75-4df5-a15f-1f8a004509d1'
where issued_by = '76c3de48-2650-4dab-b47b-a7dfa66b4698';

update admin_actions
set admin_user_id = '94529d89-ae75-4df5-a15f-1f8a004509d1'
where admin_user_id = '76c3de48-2650-4dab-b47b-a7dfa66b4698';

update admin_actions
set target_user_id = '94529d89-ae75-4df5-a15f-1f8a004509d1'
where target_user_id = '76c3de48-2650-4dab-b47b-a7dfa66b4698';

update downloads
set uploaded_by = '94529d89-ae75-4df5-a15f-1f8a004509d1'
where uploaded_by = '76c3de48-2650-4dab-b47b-a7dfa66b4698';

-- ----------------------------------------------------------------------------
-- Not migrated, intentionally -- these all reference users(id) with
-- ON DELETE CASCADE, so they clean themselves up when B is deleted below.
-- They're session/auth artifacts tied to *how* B logged in (which was
-- never, via email -- only the Telegram linking flow touched this row),
-- not business data worth preserving:
--   accounts (OAuth/credentials provider links for B)
--   sessions (any live session tokens for B)
--   signin_events (historical sign-in log for B)
--   telegram_onboarding_tokens (onboarding deep-link tokens for B)
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Finally, remove B. This should now succeed cleanly -- every FK without an
-- ON DELETE action has been repointed above.
-- ----------------------------------------------------------------------------
delete from users where id = '76c3de48-2650-4dab-b47b-a7dfa66b4698';

-- ============================================================================
-- VERIFICATION -- read the output before deciding COMMIT vs ROLLBACK.
-- ============================================================================

-- expected: exactly 1 row, status = 'active', expires_at = 2026-08-03
select id, status, expires_at
from licenses
where user_id = '94529d89-ae75-4df5-a15f-1f8a004509d1' and status = 'active';

-- expected: 0 rows -- the 4 lapsed rows are now 'revoked' (lifecycle_state
-- 'expired_processed'), not 'active'
select count(*) as should_be_zero
from licenses
where user_id = '94529d89-ae75-4df5-a15f-1f8a004509d1'
  and status = 'active'
  and expires_at <= now();

-- expected: 4 rows, all lifecycle_state = 'expired_processed'
select id, status, lifecycle_state, expires_at
from licenses
where user_id = '94529d89-ae75-4df5-a15f-1f8a004509d1'
  and lifecycle_state = 'expired_processed';

-- expected: 1 row, telegram_user_id = 7225949234, telegram_username = 'Coxwell2'
-- (NOT the placeholder/dummy value 999888777)
select id, telegram_user_id, telegram_username
from users
where id = '94529d89-ae75-4df5-a15f-1f8a004509d1';

-- expected: exactly 1 row, status = 'joined', chat_id = -1004469258486
select id, chat_id, status, joined_at
from group_memberships
where user_id = '94529d89-ae75-4df5-a15f-1f8a004509d1' and status = 'joined';

-- expected: 0 rows -- B is gone
select id from users where id = '76c3de48-2650-4dab-b47b-a7dfa66b4698';

-- ============================================================================
-- If everything above matches:  commit;
-- If anything looks wrong:      rollback;
-- ============================================================================
