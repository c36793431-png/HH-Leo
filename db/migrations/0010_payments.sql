-- Manual payments ledger for /admin/finance (bus thread
-- horizon-portal-admin-dashboard-2026-07-30) — no Stripe/checkout integration
-- exists yet, so admins log receipts by hand via the finance UI.
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  amount_usd numeric(12,2) not null,
  currency text not null default 'USD',
  source_type text not null check (source_type in ('customer', 'partner', 'affiliate', 'other')),
  counterparty text,
  user_id uuid references users(id) on delete set null,
  memo text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists payments_received_at_idx on payments(received_at desc);
create index if not exists payments_user_id_idx on payments(user_id);

insert into schema_migrations (version, name) values
  ('0010', '0010_payments.sql')
on conflict (version) do nothing;
