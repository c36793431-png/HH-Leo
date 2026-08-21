-- Partner Referral Programme, step 2: schema for manually-onboarded partners with
-- individually-negotiated gross deals (e.g. Legitcashmaker / aylrn, $600 in / $360 out,
-- 60/40 split) — kept separate from the self-serve referral_earnings system (0014).
-- Net-settle totals are computed as a query over partner_deals + deal_payments, not a
-- stored column, so nothing can drift out of sync.

create table partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  handle text unique,
  email text,
  user_id uuid references users(id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

create table partner_deals (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id),
  client_user_id uuid not null references users(id),
  gross_usd numeric(12,2) not null,
  partner_pct numeric(5,4) not null default 0.60,
  coxwell_pct numeric(5,4) not null default 0.40,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

create index partner_deals_partner_id_idx on partner_deals(partner_id);
create index partner_deals_client_user_id_idx on partner_deals(client_user_id);

-- payment_id is nullable — a deal_payments row records a real cash movement, but not every
-- cycle necessarily has a matching payments-table row on day one (human-attested only, per
-- the 2026-08-21 correction: no channel/tx-hash tracking).
create table deal_payments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references partner_deals(id),
  payment_id uuid references payments(id) on delete set null,
  amount_usd numeric(12,2) not null,
  received_at timestamptz not null default now(),
  confirmed_by text,
  notes text,
  created_at timestamptz not null default now()
);

create index deal_payments_deal_id_idx on deal_payments(deal_id);

insert into schema_migrations (version, name) values
  ('0045', '0045_partner_tables.sql')
on conflict (version) do nothing;
