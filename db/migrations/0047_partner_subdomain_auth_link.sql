-- Partner subdomain auth model (bus thread leo-partner-subdomain-auth-model-2026-08-21,
-- marcus greenlit, coxwell confirmed). Two fixes needed for the routing/session/attribution
-- bundle to actually work end-to-end for Legitcashmaker:
--
-- 1) The 0046 backfill created the `partners` row for Legitcashmaker with user_id left null
--    (it only needed a row to hang the aylrn deal off of at the time). Legitcashmaker already
--    has a real users row (telegram_username 'Legitcashmaker') from signing up normally — link
--    it now so /partner/dashboard and cross-subdomain auth resolve to a real session, and
--    promote their role to 'partner' so partner/layout.tsx's isPartnerUser gate passes.
-- 2) recordAutoPartnerPayment (lib/partners.ts) needs the same retry-safety referral_earnings
--    already has via unique(payment_id) on that table, so a retried payment write can't
--    double-book into deal_payments.

update partners p
set user_id = u.id
from users u
where p.handle = 'legitcashmaker' and p.user_id is null and u.telegram_username = 'Legitcashmaker';

update users
set role = 'partner'
where telegram_username = 'Legitcashmaker' and role = 'user';

alter table deal_payments add constraint deal_payments_payment_id_unique unique (payment_id);

insert into schema_migrations (version, name) values
  ('0047', '0047_partner_subdomain_auth_link.sql')
on conflict (version) do nothing;
