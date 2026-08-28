-- Bus thread provider-feed-subscriber-linkage-2026-08-29 (marcus, overnight block 2).
-- Two tables land together since B depends on A:
--
-- provider_client_pseudonyms is the per-provider-subscriber identity mask. A provider
-- must never see a real subscriber identity (email/name/user_id) -- they see a stable
-- label like HH1, HH2, allocated per (provider_user_id, subscriber_user_id) pair, not
-- per subscriber, so two providers can't correlate their books by comparing labels for
-- the same person. Assignment happens in application code as a side effect of a
-- subscription being created (not viewed) -- see assignPseudonym() in
-- feed-subscriptions.ts. provider_pseudonym_counters backs that with a per-provider
-- row-lock increment (a global sequence can't be scoped per provider); rows in
-- provider_client_pseudonyms are never deleted, even once every subscription
-- referencing them ends, so a label is never recycled.
create table if not exists provider_pseudonym_counters (
  provider_user_id uuid primary key references users(id),
  next_seq integer not null default 1
);

create table if not exists provider_client_pseudonyms (
  provider_user_id uuid not null references users(id),
  subscriber_user_id uuid not null references users(id),
  seq integer not null,
  created_at timestamptz not null default now(),
  primary key (provider_user_id, subscriber_user_id)
);

create unique index if not exists provider_client_pseudonyms_provider_seq_uidx
  on provider_client_pseudonyms (provider_user_id, seq);

-- feed_subscriptions is the join the provider panel's counters are missing (audited
-- 2026-08-29T13:24Z: no subscriber/subscription table anywhere in migrations
-- 0059-0067). One row per portal account subscribing to one package. v1 is one
-- provider per package, and a package is either a feed_tiers row (Horizon's own
-- regional catalogue -- the six London tiers on portal.horizonhft.com) or a
-- provider_tiers row (third-party self-onboarded provider -- feed.horizonhft.com).
-- Exactly one of feed_tier_id / provider_tier_id is set, never both, never neither.
-- Reconciling the two catalogues into one is a real commercial decision (coxwell's,
-- not made here) -- this table references either without merging them.
--
-- price_cents exists for schema coherence only; every write path in this migration's
-- companion code leaves it null. Package price is coxwell's alone to set and is never
-- public -- do not add a write path here without his sign-off.
create table if not exists feed_subscriptions (
  id uuid primary key default gen_random_uuid(),
  provider_user_id uuid not null references users(id),
  subscriber_user_id uuid not null references users(id),
  feed_tier_id uuid references feed_tiers(id),
  provider_tier_id uuid references provider_tiers(id),
  status text not null default 'trial' check (status in ('trial', 'active', 'lapsed')),
  price_cents integer,
  started_at timestamptz not null default now(),
  activated_at timestamptz,
  lapsed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feed_subscriptions_one_tier_ref check (
    (feed_tier_id is not null and provider_tier_id is null) or
    (feed_tier_id is null and provider_tier_id is not null)
  )
);

create index if not exists feed_subscriptions_provider_idx on feed_subscriptions (provider_user_id, status);
create index if not exists feed_subscriptions_subscriber_idx on feed_subscriptions (subscriber_user_id);
create index if not exists feed_subscriptions_feed_tier_idx on feed_subscriptions (feed_tier_id) where feed_tier_id is not null;
create index if not exists feed_subscriptions_provider_tier_idx on feed_subscriptions (provider_tier_id) where provider_tier_id is not null;

insert into schema_migrations (version, name) values
  ('0071', '0071_feed_subscriptions_and_pseudonyms.sql')
on conflict (version) do nothing;
