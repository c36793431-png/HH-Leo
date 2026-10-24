-- Release notice (coxwell via marcus m74711/m74713/m74741, rulings m74769 + m75122; room release-notice-2026-10-24;
-- plan v2 m74764, Fable plan review m75121 S1-S3 + C1-C8). An admin sends "version X is out" on EVERY linked channel
-- (Telegram AND email, both if both: not notifyUser's TG-then-email fallback) to two audiences:
--   A = clients: full notice. B = everyone else: a short update. The audience SQL is src/lib/release-notices.ts.
-- ADDITIVE ONLY: two new tables and ONE nullable column on users. Nothing is rewritten and no existing row changes.
--
-- release_notice_runs: one dry run and, once approved, the send of it. The user set + audience are FROZEN at the dry run
--   (recipients jsonb: user_id + audience + the predicted channels), and so are the texts: a real send needs both
--   sha256 values unchanged since the approval (approved_a_sha256 / approved_b_sha256, C3). Destinations and the
--   channel set are re-read at claim time (S3), so the frozen list says WHO, not WHERE. A text per audience:
--   subject, text_tg (plain text; the TG HTML is rendered from it), text_email (plain text verbatim + footer).
--   The approval is all-or-none: approved_at, approved_ref (the bus/TG message carrying coxwell's tap), approved_by
--   and both approved shas are set together or not at all. Approving is logged in admin_actions by the code (Q4),
--   not via the FOC hook.
--
-- release_notice_deliveries: one row per (user, version, channel) = the idempotency key. Rows are created at
--   CLAIM time. audience says which text the row got. Status (Fable S1, two failure classes):
--     claimed      in flight, finished_at null. A row stuck here (function killed mid-send) is AMBIGUOUS and is
--                  never retried automatically; an admin marks it failed_retry (logged).
--     sent         done.
--     failed_final TG 400/403, email 4xx validation, no destination: never auto-retried. An admin "retry failed"
--                  moves it to failed_retry (logged).
--     failed_retry 429 / 5xx / throw / rate limit: claimable while attempts < 3 AND now() > coalesce(retry_after_until,
--                  claimed_at). attempts caps at 3 here too (the engine enforces it; the CHECK is the second guard).
--   user_id is ON DELETE SET NULL: the audit row outlives the account (the key then no longer constrains a deleted user).
--
-- users.release_updates_opt_out_at: the B audience's unsubscribe (Q6/Q8). ONE nullable column, so coxwell's later
--   blog-update opt-in can replace it. Gates both B channels; A (a service notice for licence holders) ignores it.
--
-- APPLY BEFORE the code that writes these merges. Prod apply is Marcus's GO after Fable PASS (additive only).
-- Rollback: 0117_rollback.sql (refuses while any run or delivery exists, or any user has opted out).
alter table users
  add column if not exists release_updates_opt_out_at timestamptz;

create table if not exists release_notice_runs (
  id uuid primary key default gen_random_uuid(),
  version text not null
    constraint release_notice_runs_version_check check (length(version) between 1 and 40),
  a_subject text not null
    constraint release_notice_runs_a_subject_check check (length(a_subject) between 1 and 200),
  a_text_tg text not null
    constraint release_notice_runs_a_text_tg_check check (length(a_text_tg) between 1 and 4096),
  a_text_email text not null
    constraint release_notice_runs_a_text_email_check check (length(a_text_email) >= 1),
  a_sha256 text not null
    constraint release_notice_runs_a_sha256_check check (a_sha256 ~ '^[0-9a-f]{64}$'),
  b_subject text not null
    constraint release_notice_runs_b_subject_check check (length(b_subject) between 1 and 200),
  b_text_tg text not null
    constraint release_notice_runs_b_text_tg_check check (length(b_text_tg) between 1 and 4096),
  b_text_email text not null
    constraint release_notice_runs_b_text_email_check check (length(b_text_email) >= 1),
  b_sha256 text not null
    constraint release_notice_runs_b_sha256_check check (b_sha256 ~ '^[0-9a-f]{64}$'),
  recipients jsonb not null default '[]'::jsonb
    constraint release_notice_runs_recipients_check check (jsonb_typeof(recipients) = 'array'),
  counts jsonb not null default '{}'::jsonb
    constraint release_notice_runs_counts_check check (jsonb_typeof(counts) = 'object'),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_ref text
    constraint release_notice_runs_approved_ref_check check (approved_ref is null or length(approved_ref) between 1 and 200),
  approved_by uuid references users(id) on delete set null,
  approved_a_sha256 text
    constraint release_notice_runs_approved_a_sha256_check check (approved_a_sha256 is null or approved_a_sha256 ~ '^[0-9a-f]{64}$'),
  approved_b_sha256 text
    constraint release_notice_runs_approved_b_sha256_check check (approved_b_sha256 is null or approved_b_sha256 ~ '^[0-9a-f]{64}$'),
  constraint release_notice_runs_approval_all_or_none check (
    (approved_at is null) = (approved_ref is null)
    and (approved_at is null) = (approved_a_sha256 is null)
    and (approved_at is null) = (approved_b_sha256 is null)
  )
);

create index if not exists release_notice_runs_version_idx on release_notice_runs (version, created_at desc);

create table if not exists release_notice_deliveries (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references release_notice_runs(id) on delete restrict,
  user_id uuid references users(id) on delete set null,
  version text not null
    constraint release_notice_deliveries_version_check check (length(version) between 1 and 40),
  audience text not null
    constraint release_notice_deliveries_audience_check check (audience in ('A', 'B')),
  channel text not null
    constraint release_notice_deliveries_channel_check check (channel in ('telegram', 'email')),
  destination text
    constraint release_notice_deliveries_destination_check check (destination is null or length(destination) <= 320),
  status text not null default 'claimed'
    constraint release_notice_deliveries_status_check check (status in ('claimed', 'sent', 'failed_retry', 'failed_final')),
  provider_message_id text
    constraint release_notice_deliveries_provider_message_id_check check (provider_message_id is null or length(provider_message_id) <= 200),
  error text
    constraint release_notice_deliveries_error_check check (error is null or length(error) <= 500),
  attempts integer not null default 0
    constraint release_notice_deliveries_attempts_check check (attempts between 0 and 3),
  claimed_at timestamptz not null default now(),
  retry_after_until timestamptz,
  finished_at timestamptz,
  constraint release_notice_deliveries_key_uniq unique (user_id, version, channel),
  constraint release_notice_deliveries_finished_iff_not_claimed check ((status = 'claimed') = (finished_at is null))
);

create index if not exists release_notice_deliveries_run_status_idx on release_notice_deliveries (run_id, status);

insert into schema_migrations (version, name) values
  ('0117', '0117_release_notices.sql')
on conflict (version) do nothing;
