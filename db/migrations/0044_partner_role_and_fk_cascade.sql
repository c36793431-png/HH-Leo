-- Partner Referral Programme, step 1 (bus thread leo-partner-referral-programme-build-2026-08-21,
-- marcus approved end-to-end). Adds the 'partner' role for manually-onboarded partners
-- (e.g. Legitcashmaker) — separate from the existing self-serve referral_earnings system.

alter table users drop constraint users_role_check;
alter table users add constraint users_role_check
  check (role in ('user', 'admin', 'partner'));

-- Bundled fix (unrelated to partner tables, but touches payments/referral_earnings and
-- there's no reason to block it on a separate migration): deleting a payment currently
-- fails if a referral_earnings row references it. Cascade so admin can delete/void
-- payments (needed for the aylrn backfill in 0046) without a manual pre-delete step.
alter table referral_earnings drop constraint referral_earnings_payment_id_fkey;
alter table referral_earnings add constraint referral_earnings_payment_id_fkey
  foreign key (payment_id) references payments(id) on delete cascade;

insert into schema_migrations (version, name) values
  ('0044', '0044_partner_role_and_fk_cascade.sql')
on conflict (version) do nothing;
