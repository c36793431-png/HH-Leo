-- Real license tier taxonomy (bus thread horizon-portal-admin-dashboard-2026-07-30,
-- marcus/coxwell). Repurposes the existing licenses.tier column rather than adding a
-- second "tier" concept — it was added in 0004 for a product-edition axis that never
-- shipped (every row is still 'full'), and admin/licenses + admin/users already read/
-- filter/display it, so this is the natural home for trial/paid/team. Free/Admin are
-- NOT license tiers — Free = no license row, Admin = users.role='admin' — so they stay
-- derived, not stored here.
update licenses set tier = 'paid' where tier = 'full';

alter table licenses alter column tier set default 'paid';
alter table licenses add constraint licenses_tier_check check (tier in ('trial', 'paid', 'team'));

insert into schema_migrations (version, name) values
  ('0012', '0012_license_tier_taxonomy.sql')
on conflict (version) do nothing;
