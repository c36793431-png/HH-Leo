-- Black tier "Coming Soon" waitlist (coxwell, leo-tiers-black-coming-soon-waitlist-2026-08-21).
-- Separate table rather than a feed_tier_requests.request_type column: that table's
-- user_id/license_id/server echo is tied to the existing "confirm my server + license"
-- request flow, which doesn't fit a plain "notify me when this launches" signup.
create table if not exists tier_waitlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  region text not null default 'london',
  tier_key text not null default 'black',
  created_at timestamptz not null default now(),
  unique (user_id, region, tier_key)
);
