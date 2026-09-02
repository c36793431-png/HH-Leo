-- referred_by_partner_id on users (bus thread partner-referral-attribution-2026-09-02,
-- coxwell approved 2026-09-02 "lets try"). Step 1 of a two-step job -- SQL only, no
-- application code lands with this migration. The signup-capture code that populates
-- this column going forward (and widens ref-cookie capture past /signup,/login -- see
-- report to marcus) is a separate, later change; do not apply that until this is
-- confirmed live in prod.
--
-- Why a column, not a table: users.referred_by_user_id (0014_referrals.sql) is already
-- the single, first-touch attribution field for every referral -- attributeReferralFromCookie
-- (src/lib/referrals-cookie.ts) only ever sets it once, when null. A separate attribution
-- table would let partner-referral records accumulate across multiple touches while
-- referred_by_user_id stays first-touch-only -- two attribution models for the same
-- event, able to disagree. A nullable column matches the existing semantics exactly.
--
-- Why a new column and not just resolving referred_by_user_id -> getPartnerByUserId()
-- (src/lib/referrals.ts) at read time, as done today: that join only tells you the
-- referrer *currently* holds a partner record -- it silently changes answer if the
-- referrer's partner status is later revoked, and it requires a join everywhere the
-- Referrals/Clients pages or a future notification job need "who are my referred
-- clients". This column captures the fact as it was true at signup-attribution time
-- and makes it a direct, indexed lookup for partner-facing surfaces.
--
-- Not touching users.referred_by_user_id -- that stays the general (peer-or-partner)
-- referral chain feeding referral_earnings today. This column is additive and
-- partner-specific, populated only when the referrer was a partner at attribution time.

alter table users
  add column if not exists referred_by_partner_id uuid references partners(id) on delete set null;

create index if not exists users_referred_by_partner_id_idx on users (referred_by_partner_id);

comment on column users.referred_by_partner_id is
  'Partner who referred this user, captured at signup-attribution time (see referred_by_user_id / attributeReferralFromCookie). Null if the referrer was not a partner, or no referral was ever attributed. Denormalized from partners for direct partner-facing queries; not updated if the referring partner is later deactivated or the role revoked.';

-- Backfill pass 1: partner_deals already states (partner_id, client_user_id) directly
-- for every existing manually-recorded deal -- no join through payments or heuristics
-- needed. Recovers history for clients onboarded before this column existed.
update users u
set referred_by_partner_id = pd.partner_id
from partner_deals pd
where pd.client_user_id = u.id
  and u.referred_by_partner_id is null;

-- Backfill pass 2: recover cases where referred_by_user_id already points at a
-- partner's own user row (the pre-existing read-time resolution path) but no
-- partner_deals row was ever recorded for it -- e.g. a signup attributed via the
-- referral cookie to a partner's personal referral_code with no deal logged.
update users u
set referred_by_partner_id = p.id
from partners p
where p.user_id = u.referred_by_user_id
  and u.referred_by_partner_id is null;

-- Verification: partner_attributed_users should be >= the number of distinct
-- client_user_id values in partner_deals; any_attributed_users is the existing
-- (peer+partner) baseline and must not change.
select
  (select count(*) from users where referred_by_partner_id is not null) as partner_attributed_users,
  (select count(*) from users where referred_by_user_id is not null) as any_attributed_users;

insert into schema_migrations (version, name) values
  ('0077', '0077_users_referred_by_partner_id.sql')
on conflict (version) do nothing;
