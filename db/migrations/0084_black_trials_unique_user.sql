-- *** NOT YET APPLIED *** — handed off per standing policy (Leo writes migrations, never
-- applies them; marcus/coxwell run this against prod). Thread leo-black-feed-3day-trial-2026-09-10.
--
-- What this does: replaces black_trials' one-per-license uniqueness with one-per-client
-- (user), so a client can never hold more than one Black trial regardless of how many
-- licenses they have. Drops unique(license_id) (0041) and adds unique(user_id) in its place —
-- replacing rather than adding both, since per-user strictly subsumes per-license (a unique
-- user_id already rules out a second license row for that same user).
--
-- Why this is a REVERSAL, not a bugfix: 0041's unique(license_id) was a deliberate, sourced
-- design choice — its own header comment and commit 9bbd5a3 (2026-08-16) both attribute the
-- per-license shape to coxwell's own answer on thread m21921b, drawing a deliberate analogy to
-- server_registrations' existing one-per-license pattern. Today (2026-09-10) coxwell ruled
-- the opposite: "the client can get it only one time. Doesn't matter what licence they have,
-- just one portal user 1 time for black feed." That is a considered reversal of his 08-16
-- decision, not drift being corrected — flagged and confirmed with marcus/coxwell in-thread
-- (m47314/m47321) before this file was written.
--
-- Safety evidence (marcus, live Neon MCP read, 2026-09-10T17:13Z): black_trials held 3 rows,
-- 3 distinct user_id, 3 distinct license_id at that time — zero duplicates, so unique(user_id)
-- builds cleanly against data as of that check. If the live row count no longer matches this
-- by the time this is applied, STOP and re-verify rather than running it blind.
--
-- Accompanying code change required at apply time: src/lib/black-trials.ts's requestBlackTrial
-- no longer names either constraint directly (it catches Postgres unique-violation (23505)
-- generically instead of using ON CONFLICT (license_id)), specifically so it keeps working
-- across this migration without a coordinated code deploy. No code change is required in the
-- same deploy as this migration for that reason, but confirm nothing else in the codebase
-- still assumes unique(license_id) before applying.

alter table black_trials
  drop constraint if exists black_trials_license_id_key,
  add constraint black_trials_user_id_key unique (user_id);

insert into schema_migrations (version, name) values
  ('0084', '0084_black_trials_unique_user.sql')
on conflict (version) do nothing;
