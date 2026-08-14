-- Trial feature for LD Alpha + LD Ultra (marcus/coxwell, bus thread
-- horizon-portal-v2051-polish-2026-08-13, "Trial feature" add-on). Sibling table to
-- feed_tier_requests (0034) rather than an extension of it: requests are an
-- approval workflow (pending/approved/rejected/provisioned) actioned by an admin,
-- while a trial is self-service, time-bound, and has its own lifecycle
-- (active/expired/converted/cancelled) plus reminder/expiry bookkeeping that has
-- no equivalent on the request row. Overloading feed_tier_requests.status with a
-- second, unrelated state machine would make both harder to reason about.
--
-- One-trial-per-user-per-tier is enforced at the DB level via the unique index
-- below (not just app-level), since it's the actual product rule from coxwell
-- ("You've already trialed this tier") and a race between two requests should
-- fail loudly rather than double-book.
create table if not exists feed_tier_trials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  license_id uuid not null references licenses(id) on delete cascade,
  region text not null check (region in ('london', 'ny', 'cme', 'tokyo')),
  tier_key text not null check (tier_key in ('ld-alpha-85', 'ld-ultra')),
  trial_status text not null default 'active' check (trial_status in ('active', 'expired', 'converted', 'cancelled')),
  trial_started_at timestamptz not null default now(),
  trial_ends_at timestamptz not null,
  reminder_sent_at timestamptz,
  ended_notified_at timestamptz,
  converted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

-- Enforces "any trial row for that tier, regardless of status, blocks a new one".
create unique index if not exists feed_tier_trials_user_tier_uidx on feed_tier_trials (user_id, tier_key);
create index if not exists feed_tier_trials_status_idx on feed_tier_trials (trial_status, trial_ends_at);

insert into schema_migrations (version, name) values
  ('0036', '0036_feed_tier_trials.sql')
on conflict (version) do nothing;
