-- Coxwell comped himself a team-tier license via the admin panel; the auto-billing
-- hook still logged a $100 "Paid tier license activation" row because the quick-issue
-- form on /admin had no tier field (always defaulted to paid). One-off cleanup of the
-- resulting phantom row — see wave-bb payment-auto-hook-tier-gating dispatch.
delete from payments
where counterparty = 'c36793431@gmail.com'
  and memo like '%0e777f77%'
  and amount_usd = 100.00
  and direction = 'in';

insert into schema_migrations (version, name) values
  ('0024', '0024_backfill_delete_phantom_team_payment.sql')
on conflict (version) do nothing;
