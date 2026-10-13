-- Horizon Complete bundle, slice 1 (plan m66837-9, folds m66997/m67030/m67035, Fable combined verdict m67049,
-- build GO marcus m67050). One bundle = one licence (its expires_at is the bundle's only clock) + the stamped
-- feed rows of the chosen Base package + one 'bundle' payment. No expiry column anywhere: liveness is derived
-- from the licence, so a copy would need a resync writer.
--
-- bundle_subscriptions: one row per sold bundle.
--   license_adopted: NOT NULL with NO default (the tier-default footgun, 0012:9). activateBundle always writes it.
--   end_mode: NULL until ended. 'cancel' revoked the licence; 'unbundle' left it active.
--   The stamp CHECK is two conjoined equalities: `a = b = c` is a syntax error in Postgres (fold m67030 N3).
--   lapse_card_sent_at: the daily lapse card's claim (slice 3 cron pass). No writer in slice 1.
--   Partial uniques: one active bundle per licence (plan) and one per user (Q-H, ruled refuse, m66848).
-- licenses.revoked_at: written by revokeLicense in both branches (5a S3); the lapse card counts days from it.
-- feed_subscriptions.bundle_subscription_id: which feed rows a bundle granted. endBundle lapses only these.
-- payments.bundle_subscription_id + category 'bundle': the bundle's money. No ON DELETE action on either fk, so a
--   bundle with feeds or money against it can never be deleted from under them (0100:7-8 shape).
-- payments_category_check: prod read 2026-10-13 13:17Z = exactly 0100's eight values. This file re-adds them plus
--   'bundle'. If 0108 ('nova') applies first, re-read prod before applying this and carry both values.
--
-- Additive only. APPLY BEFORE THE CODE REACHES MAIN: plain assignFeedTierSubscription reads
-- feed_subscriptions.bundle_subscription_id, revokeLicense writes licenses.revoked_at and insertPayment names
-- payments.bundle_subscription_id, so without this file every admin feed grant, every revoke and every payment
-- insert through it (licence auto rows, Finance "Add payment") fails. Rollback: 0107_rollback.sql.
begin;

create table if not exists bundle_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  bundle_key text not null check (bundle_key in ('horizon-complete')),
  feed_choice text not null check (feed_choice in ('ld-base', 'ny-base')),
  license_id uuid not null references licenses(id),
  basket_request_id uuid references basket_requests(id) on delete set null,
  status text not null check (status in ('active', 'ended')),
  is_trial boolean not null default false,
  license_adopted boolean not null,
  activated_at timestamptz not null default now(),
  activated_by uuid not null references users(id),
  ended_at timestamptz,
  ended_by uuid references users(id),
  end_reason text,
  end_mode text check (end_mode in ('cancel', 'unbundle')),
  lapse_card_sent_at timestamptz,
  constraint bundle_subscriptions_ended_stamp check (
    ((status = 'ended') = (ended_at is not null)) and ((status = 'ended') = (end_mode is not null))
  )
);

create unique index if not exists bundle_subscriptions_license_active_uidx
  on bundle_subscriptions(license_id) where status = 'active';
create unique index if not exists bundle_subscriptions_user_active_uidx
  on bundle_subscriptions(user_id) where status = 'active';

alter table licenses add column if not exists revoked_at timestamptz;

alter table feed_subscriptions add column if not exists bundle_subscription_id uuid references bundle_subscriptions(id);
create index if not exists feed_subscriptions_bundle_subscription_id_idx on feed_subscriptions(bundle_subscription_id);

alter table payments add column if not exists bundle_subscription_id uuid references bundle_subscriptions(id);
create index if not exists payments_bundle_subscription_id_idx on payments(bundle_subscription_id);

alter table payments drop constraint payments_category_check;
alter table payments add constraint payments_category_check
  check (category in ('customer', 'partner', 'affiliate', 'feed_provider', 'infra', 'other', 'referral_payout', 'feed_access', 'bundle'));

insert into schema_migrations (version, name) values
  ('0107', '0107_bundle_subscriptions.sql')
on conflict (version) do nothing;

commit;
