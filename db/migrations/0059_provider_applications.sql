-- Public feed-provider application intake (feed.horizonhft.com/providers/apply), bus thread
-- leo-feed-login-and-apply-implementation-2026-08-22, mockups/horizon-feed-provider/
-- feed-apply.html. Feed-provider analogue of 0055's partner_applications: a company applies
-- to publish its market-data feed through Horizon's distribution network, admin reviews the
-- row here, then binds the provider in the existing admin register-provider.html surface (out
-- of scope for this pass -- no admin review queue is built yet, see feed-apply-spec.md).
--
-- Connection fields (protocol/host/port/compid) are nullable -- the public form marks them
-- optional (Feedverse verifies the endpoint before go-live, per the mockup's divergence note).
-- No price columns -- pricing is bound into provider_tiers by admin at register time.
create table provider_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  name text not null,
  email text not null,
  contact_name text,
  country text,
  timezone text,
  website_url text,
  protocol text,
  host text,
  port text,
  compid text,
  regions text,
  coverage text,
  tiers_offered text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  applied_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references users(id),
  admin_notes text
);

create index provider_applications_status_idx on provider_applications(status);
create index provider_applications_email_idx on provider_applications(lower(email));

insert into schema_migrations (version, name) values
  ('0059', '0059_provider_applications.sql')
on conflict (version) do nothing;
