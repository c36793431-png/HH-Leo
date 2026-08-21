-- Partner signup + admin-approval flow (bus thread
-- leo-partner-page-broken-auth-buttons-2026-08-22, marcus approved). partner.horizonhft.com's
-- /apply form lands here; admin approves/declines from /admin/partner-applications the same
-- way feed_tier_requests does. Separate table from `partners` (0045) -- that one is the
-- manually-onboarded, individually-negotiated-deal roster (Legitcashmaker/aylrn); this is the
-- self-serve "someone asked to become a partner" intake queue, which only grants the plain
-- users.role = 'partner' flag (no deal/split terms) on approval.
create table partner_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  name text not null,
  email text not null,
  telegram text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  applied_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references users(id),
  admin_notes text
);

create index partner_applications_status_idx on partner_applications(status);
create index partner_applications_email_idx on partner_applications(lower(email));

insert into schema_migrations (version, name) values
  ('0055', '0055_partner_applications.sql')
on conflict (version) do nothing;
