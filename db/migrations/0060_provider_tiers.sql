-- Register Provider (admin/register-provider), bus thread leo-feed-admin-split-2026-08-23
-- (Iris's Approve -> register-provider pre-fill contract). provider_tiers is the third-party
-- feed-provider analogue of feed_tiers (0035) -- deliberately a separate table, not a reuse:
-- feed_tiers models Horizon's own fixed regional latency catalogue (region_key constrained to
-- london/ny/cme/tokyo, no split/endpoint columns), whereas a registered provider's tiers carry
-- fields feed_tiers has no room for (client_price, provider_split, endpoint go-live binding)
-- and aren't confined to that region enum.
--
-- onboarded_at on provider_applications is the Live/pending-onboarding split: Approve (in
-- provider-applications actions) sets status='approved' only; register-provider's submit here
-- is what stamps onboarded_at once provider_tiers rows exist, so an abandoned registration
-- leaves the application "approved / pending onboarding" instead of a phantom-live provider
-- with no tiers.
alter table provider_applications add column if not exists onboarded_at timestamptz;

create table provider_tiers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references provider_applications(id),
  provider_user_id uuid not null references users(id),
  tier_name text not null,
  client_price_cents integer not null,
  provider_split_pct integer not null default 50,
  endpoint_host text,
  endpoint_port text,
  endpoint_verified boolean not null default false,
  published_at timestamptz not null default now()
);

create index provider_tiers_application_idx on provider_tiers (application_id);
create index provider_tiers_provider_idx on provider_tiers (provider_user_id);

insert into schema_migrations (version, name) values
  ('0060', '0060_provider_tiers.sql')
on conflict (version) do nothing;
