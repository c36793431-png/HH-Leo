-- Speed-tier catalogue for the /feeds/[region]/tiers drill-in (marcus/coxwell/Iris,
-- bus thread horizon-portal-v2051-polish-2026-08-13, "LD tier cards" Option B build).
-- tier_key matches the values already used by feed_tier_requests (0034) / tierKey
-- validation in feed-tier-catalogue.ts, so a request row and its catalogue detail
-- always resolve to the same identity.
create table if not exists feed_tiers (
  id uuid primary key default gen_random_uuid(),
  region_key text not null check (region_key in ('london', 'ny', 'cme', 'tokyo')),
  tier_key text not null unique,
  name text not null,
  subtitle text not null,
  speed_display text not null,
  latency_us integer,
  description text not null,
  price_cents integer,
  is_flagship boolean not null default false,
  path_redundancy text not null,
  support_level text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists feed_tiers_region_idx on feed_tiers (region_key, sort_order);

insert into feed_tiers
  (region_key, tier_key, name, subtitle, speed_display, latency_us, description, price_cents, is_flagship, path_redundancy, support_level, sort_order)
values
  ('london', 'ld-alpha-85', 'LD Alpha 85', 'ENTRY', '85', 85, 'Entry-level London colo feed. Good starting point for strategies that aren''t latency-critical.', null, false, 'Single path', 'Standard', 10),
  ('london', 'ld-beta-56', 'LD Beta 56', 'STANDARD', '56', 56, 'Faster path than Alpha for strategies that need more headroom without going full low-latency.', null, false, 'Single path', 'Standard', 20),
  ('london', 'ld-gamma-19', 'LD Gamma 19', 'LOW LATENCY', '19', 19, 'Low-latency tier with a dedicated dual path for tighter, more consistent timing.', null, false, 'Dual path', 'Priority', 30),
  ('london', 'ld-delta-18', 'LD Delta 18', 'ULTRA LOW LATENCY', '18', 18, 'Our fastest fixed-latency tier below Ultra, tuned for strategies competing on speed.', null, false, 'Dual path', 'Priority', 40),
  ('london', 'ld-ultra', 'LD Ultra', 'FLAGSHIP', 'MIN', null, 'Flagship London tier -- minimum achievable latency on our infrastructure, triple-path redundant with dedicated support.', null, true, 'Triple path (redundant)', 'White-glove (dedicated)', 50),
  ('ny', 'ny-normal', 'NY Normal', 'STANDARD', '—', null, 'Standard New York feed tier. Real latency figure pending -- not yet exposed by the client.', null, false, 'Single path', 'Standard', 10),
  ('ny', 'ny-fast', 'NY Fast', 'LOW LATENCY', '—', null, 'Faster New York feed tier. Real latency figure pending -- not yet exposed by the client.', null, false, 'Dual path', 'Priority', 20)
on conflict (tier_key) do nothing;

insert into schema_migrations (version, name) values
  ('0035', '0035_feed_tiers.sql')
on conflict (version) do nothing;
