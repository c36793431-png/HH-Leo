-- License tier backfill for known accounts (bus thread
-- horizon-portal-admin-dashboard-2026-07-30, marcus/coxwell). The 'deal' tier
-- and its check constraint already landed in 0013 (jaymob123@gmail.com
-- backfilled there). This migration covers the remaining named corrections
-- coxwell confirmed: Alonzo (trial), sahilsahu202@gmail.com (team), and
-- Wwwsss (paid, cash) — the latter identified by telegram_username/
-- display_name since "Wwwsss" isn't an email. Each targets only the most
-- recent active license per user (mirrors 0013's pattern) and is safe to
-- re-run. No blanket "everyone else -> paid" here: the licenses.tier default
-- is already 'paid' since 0012, and re-asserting it here would risk
-- clobbering tier corrections made via the /admin/licenses dropdown since
-- then.

update licenses set tier = 'trial'
where id = (
  select l.id from licenses l
  join users u on u.id = l.user_id
  where u.email ilike 'alonzo%' and l.status = 'active'
  order by l.expires_at desc
  limit 1
);

update licenses set tier = 'team'
where id = (
  select l.id from licenses l
  join users u on u.id = l.user_id
  where u.email = 'sahilsahu202@gmail.com' and l.status = 'active'
  order by l.expires_at desc
  limit 1
);

update licenses set tier = 'paid'
where id = (
  select l.id from licenses l
  join users u on u.id = l.user_id
  where (u.telegram_username = 'Wwwsss' or u.display_name = 'Wwwsss') and l.status = 'active'
  order by l.expires_at desc
  limit 1
);

update licenses set tier = 'deal'
where id = (
  select l.id from licenses l
  join users u on u.id = l.user_id
  where u.email = 'jaymob123@gmail.com' and l.status = 'active'
  order by l.expires_at desc
  limit 1
);

insert into schema_migrations (version, name) values
  ('0015', '0015_license_tier_backfill.sql')
on conflict (version) do nothing;
