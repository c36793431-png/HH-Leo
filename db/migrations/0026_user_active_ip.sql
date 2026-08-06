-- Admin-maintained note of which IP a user is currently trading from
-- (VPS/home/etc). Free text, no validation — support/whitelisting aid,
-- per coxwell's request.
alter table users add column if not exists active_ip text;

insert into schema_migrations (version, name) values
  ('0026', '0026_user_active_ip.sql')
on conflict (version) do nothing;
