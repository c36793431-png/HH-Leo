-- "Add your strategy" v2 shape (bus thread leo-strategies-add-your-strategy-2026-08-21,
-- marcus greenlit Plan B, coxwell confirmed). Author-submission catalog entity, distinct
-- from strategy_requests' request-triage lifecycle. "Request a strategy" (pitch flow)
-- stays on strategy_requests untouched.
--
-- v2 marketplace fields (payout account, publish_status, strategy_activations FK, etc.)
-- intentionally NOT added yet -- schema leaves room to slot them in later without a
-- structural rework (see HANDOFF_strategy_marketplace_v1v2_architecture_2026-08-21.md).

create table if not exists strategy_submissions (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid not null references users(id) on delete cascade,
  submission_type text not null default 'structured'
    check (submission_type in ('structured')),
  name text not null,
  category text not null
    check (category in ('arbitrage', 'momentum', 'grid', 'scalping', 'custom')),
  instruments text[] not null default '{}',
  feed_region text
    check (feed_region is null or feed_region in ('london', 'ny', 'cme', 'tokyo')),
  description text not null,
  contact_preference text not null
    check (contact_preference in ('portal', 'telegram', 'email')),
  status text not null default 'pending'
    check (status in ('pending', 'under_review', 'approved_draft', 'listed', 'declined', 'withdrawn')),
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists strategy_submissions_status_idx on strategy_submissions (status);
create index if not exists strategy_submissions_author_idx on strategy_submissions (author_user_id);

insert into schema_migrations (version, name) values
  ('0053', '0053_strategy_submissions.sql')
on conflict (version) do nothing;
