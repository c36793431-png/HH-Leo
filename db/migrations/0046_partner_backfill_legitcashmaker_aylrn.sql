-- Partner Referral Programme, step 3: backfill the first real partner deal.
-- aylrn (giang2000ln@gmail.com, telegram @aylrn09) was activated under a stale $100
-- customer-category auto-payment row from the license-activation hook. That's wrong
-- under the new gross-deal model — Legitcashmaker brought aylrn in as a negotiated
-- $600 gross / 60% partner ($360) / 40% coxwell ($240) deal, not a $100 self-serve
-- signup. Void the stale row and replace it with the correct partner-deal rows.
-- Corrective delta, not data loss (marcus, 2026-08-21 approval).

do $$
declare
  v_partner_id uuid;
  v_client_id uuid;
  v_deal_id uuid;
  v_payment_in_id uuid;
  v_payment_out_id uuid;
begin
  select id into v_client_id from users where email = 'giang2000ln@gmail.com';
  if v_client_id is null then
    raise exception 'backfill: aylrn user (giang2000ln@gmail.com) not found';
  end if;

  insert into partners (name, handle, status)
  values ('Legitcashmaker', 'legitcashmaker', 'active')
  returning id into v_partner_id;

  insert into partner_deals (partner_id, client_user_id, gross_usd, partner_pct, coxwell_pct, status)
  values (v_partner_id, v_client_id, 600.00, 0.60, 0.40, 'active')
  returning id into v_deal_id;

  insert into payments (received_at, amount_usd, currency, direction, category, counterparty, user_id, memo, created_by)
  values (now(), 600.00, 'USD', 'in', 'partner', 'Legitcashmaker', v_client_id,
          'Partner deal backfill — aylrn gross intake (deal ' || v_deal_id || ')', 'backfill-2026-08-21')
  returning id into v_payment_in_id;

  insert into payments (received_at, amount_usd, currency, direction, category, counterparty, user_id, memo, created_by)
  values (now(), 360.00, 'USD', 'out', 'partner', 'Legitcashmaker', null,
          'Partner deal backfill — Legitcashmaker 60% share (deal ' || v_deal_id || ')', 'backfill-2026-08-21')
  returning id into v_payment_out_id;

  insert into deal_payments (deal_id, payment_id, amount_usd, received_at, confirmed_by, notes)
  values (v_deal_id, v_payment_in_id, 600.00, now(), 'backfill-2026-08-21',
          'Gross intake backfilled from stale $100 customer payment row');

  -- Void the stale $100 auto-written customer-category row from the activation hook.
  delete from payments where id = '2e2959bc-b03a-4afc-9068-fc06ca6fe43d' and category = 'customer' and amount_usd = 100.00;
end $$;

insert into schema_migrations (version, name) values
  ('0046', '0046_partner_backfill_legitcashmaker_aylrn.sql')
on conflict (version) do nothing;
