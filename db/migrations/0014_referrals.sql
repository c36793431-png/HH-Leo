-- Referral system (bus thread horizon-portal-referral-system-2026-07-30,
-- coxwell's model): 30% recurring commission on every payment from a referred
-- user, for the lifetime of their paid tier, 14-day clawback window, $50 min
-- payout. referral_code/referred_by_user_id live on users; earnings are one
-- row per triggering payment so the amount/rate are captured historically
-- even if the 30% rate ever changes.

alter table users add column referral_code text unique;
alter table users add column referred_by_user_id uuid references users(id);
alter table users add column referred_at timestamptz;

create index users_referred_by_user_id_idx on users(referred_by_user_id);

create table referral_earnings (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references users(id),
  referred_user_id uuid not null references users(id),
  payment_id uuid not null unique references payments(id),
  amount_usd numeric(12,2) not null,
  rate numeric(5,4) not null default 0.30,
  status text not null default 'pending' check (status in ('pending', 'cleared', 'clawback', 'paid')),
  earned_at timestamptz not null default now(),
  cleared_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index referral_earnings_referrer_status_idx on referral_earnings (referrer_user_id, status);
create index referral_earnings_referred_user_id_idx on referral_earnings (referred_user_id);

-- Payout runs get logged through the same payments ledger (direction=out) so
-- Finance totals stay accurate; referral_payout is a new category alongside
-- the existing customer/partner/affiliate/feed_provider/infra/other set.
alter table payments drop constraint payments_category_check;
alter table payments add constraint payments_category_check
  check (category in ('customer', 'partner', 'affiliate', 'feed_provider', 'infra', 'other', 'referral_payout'));

-- Backfill a human-friendly referral_code for every existing user (HFT-XXXXX,
-- matches spec example HFT-A7K2Q). New users get theirs assigned at signup
-- time in application code (lib/referrals.ts getOrCreateReferralCode is the
-- self-healing fallback if that ever races or fails).
do $$
declare
  r record;
  new_code text;
  attempt int;
begin
  for r in select id from users where referral_code is null loop
    attempt := 0;
    loop
      new_code := 'HFT-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5));
      begin
        update users set referral_code = new_code where id = r.id;
        exit;
      exception when unique_violation then
        attempt := attempt + 1;
        if attempt > 10 then
          raise exception 'failed to generate unique referral code for user %', r.id;
        end if;
      end;
    end loop;
  end loop;
end $$;

insert into schema_migrations (version, name) values
  ('0014', '0014_referrals.sql')
on conflict (version) do nothing;
