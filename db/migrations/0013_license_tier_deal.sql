-- Add "deal" license tier. Deal = bartered license (user traded another software for it, not
-- cash) — a real customer category, distinguished from paid in the dashboard breakdown,
-- but never counted as revenue since the payments table stays keyed off actual payment
-- rows, not license tier.
alter table licenses drop constraint licenses_tier_check;
alter table licenses add constraint licenses_tier_check check (tier in ('trial', 'paid', 'team', 'deal'));

update licenses set tier = 'deal'
where id = (
  select l.id from licenses l
  join users u on u.id = l.user_id
  where u.email = 'jaymob123@gmail.com' and l.status = 'active'
  order by l.expires_at desc
  limit 1
);

insert into schema_migrations (version, name) values
  ('0013', '0013_license_tier_deal.sql')
on conflict (version) do nothing;
