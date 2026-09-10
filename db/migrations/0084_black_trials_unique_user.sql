-- APPLIED 2026-09-10 ~20:10Z by marcus, as an explicit transaction, after coxwell ruled at
-- 20:04Z that the SQL pastes were marcus's to run. This header previously read "*** NOT YET
-- APPLIED ***"; corrected here so it doesn't mislead a future reader, same as 0081's header.
-- Verified at the objects rather than the ledger (both marcus and leo read independently):
-- black_trials_user_started_key present as UNIQUE (user_id) WHERE status in
-- ('requested','active','converted'); black_trials_license_id_key absent from pg_indexes AND
-- pg_constraint; '0084' present in schema_migrations. Handed off per standing policy (Leo
-- writes migrations, never applies them). Thread leo-black-feed-3day-trial-2026-09-10.
--
-- What this does: replaces black_trials' one-per-license uniqueness with one-per-client
-- (user) -- but only across the statuses where a trial actually started or is in flight, not
-- every row ever inserted. Drops unique(license_id) (0041) and adds a PARTIAL unique index on
-- user_id, scoped to status in ('requested','active','converted').
--
-- REVISED 2026-09-10, same day, before this ever reached coxwell's paste queue (thread
-- leo-black-feed-3day-trial-2026-09-10, marcus m47390-ish): the version first committed here
-- used a plain `unique (user_id)` table constraint, which encodes "one row ever" -- a declined
-- request would occupy the slot forever. marcus ruled that out: coxwell's words were "only one
-- client gets only one 3 day trial" -- the subject is a *trial*, and a declined or abandoned
-- request never became one. So:
--   - 'declined'                      -- excluded. Never blocks a future request.
--   - 'requested' (pending)           -- included. Blocks a second *concurrent* request (don't
--                                        let someone queue five) but is not a permanent burn --
--                                        once it resolves to declined it drops out of the index.
--   - 'active' / 'converted'          -- included. A trial that started or was kept is the
--                                        permanent burn: "one trial per client, ever".
-- This lands before coxwell's queue specifically so the cheaper, correct shape ships instead of
-- the reversed one -- 0084 was held out of the paste queue for exactly this reason.
--
-- Why the *first* uniqueness change (license_id -> user_id, independent of the above revision)
-- is a REVERSAL, not a bugfix: 0041's unique(license_id) was a deliberate, sourced design
-- choice — its own header comment and commit 9bbd5a3 (2026-08-16) both attribute the
-- per-license shape to coxwell's own answer on thread m21921b, drawing a deliberate analogy to
-- server_registrations' existing one-per-license pattern. Today (2026-09-10) coxwell ruled
-- the opposite: "the client can get it only one time. Doesn't matter what licence they have,
-- just one portal user 1 time for black feed." That is a considered reversal of his 08-16
-- decision, not drift being corrected — flagged and confirmed with marcus/coxwell in-thread
-- (m47314/m47321) before this file was written.
--
-- Safety evidence (marcus, live Neon MCP read, 2026-09-10T17:13Z): black_trials held 3 rows,
-- 3 distinct user_id, 3 distinct license_id at that time — zero duplicates, so this index
-- builds cleanly against data as of that check regardless of which statuses those 3 rows carry
-- (a partial index is strictly less restrictive than the plain unique(user_id) it replaces).
-- If the live row count no longer matches this by the time this is applied, STOP and
-- re-verify rather than running it blind. -- marcus did exactly that: he re-ran the check
-- immediately before applying rather than trusting the 17:13Z read, and it matched this
-- header's condition exactly (3 rows, 3 distinct user_id, 3 distinct license_id, all 3 in the
-- indexed statuses). Recorded because the pre-flight, not the 17:13Z snapshot, is what
-- actually gated the apply.
--
-- Accompanying code change required at apply time: src/lib/black-trials.ts's requestBlackTrial
-- no longer names either constraint directly (it catches Postgres unique-violation (23505)
-- generically instead of using ON CONFLICT (license_id)), specifically so it keeps working
-- across this migration without a coordinated code deploy. requestBlackTrial's own pre-checks
-- (getStartedBlackTrialForUser / getPendingBlackTrialForUser) already implement the same
-- ('requested','active','converted') scoping as this index in application code, so the index
-- is a race backstop, not the sole enforcement -- confirm nothing else in the codebase still
-- assumes unique(license_id) before applying.

alter table black_trials
  drop constraint if exists black_trials_license_id_key,
  drop constraint if exists black_trials_user_id_key;

create unique index if not exists black_trials_user_started_key
  on black_trials (user_id)
  where status in ('requested', 'active', 'converted');

insert into schema_migrations (version, name) values
  ('0084', '0084_black_trials_unique_user.sql')
on conflict (version) do nothing;
