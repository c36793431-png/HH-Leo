-- Manual provider registration (bus thread iris-register-provider-manual-mode-2026-08-24):
-- /admin/register-provider gets a second entry point (bare URL, no ?from_application) for
-- admin-initiated onboarding of a provider that never filed a public application. That path
-- inserts a synthetic provider_applications row directly (status='approved' from creation,
-- skipping the public pending state) so it can flow through the existing registerProviderTiers
-- publish step unchanged. This column is how the two entry points stay reconcilable in history:
-- a manual row legitimately has no public-application trail, and this says why.
alter table provider_applications
  add column source text not null default 'application';

alter table provider_applications
  add constraint provider_applications_source_check
  check (source in ('application', 'admin_manual'));

insert into schema_migrations (version, name) values
  ('0066', '0066_provider_application_source.sql')
on conflict (version) do nothing;
