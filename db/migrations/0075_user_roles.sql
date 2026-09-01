-- user_roles join table (bus thread user-roles-migration-2026-09-01, marcus/coxwell,
-- approved 2026-08-31 "yes user roles makes sense also yes"). Additive only --
-- users.role stays as the display/primary role so the ~21 pages reading it don't
-- all change at once; retiring that column is a separate future decision.
--
-- Provider onboarding today overwrites users.role with no record of what was
-- there before, so one account can only ever show one hat. coxwell's own account
-- is the concrete case: it renders as "Feed provider" on /admin/users despite
-- being both the admin and a licence holder. This table lets an account hold
-- more than one role at once, and remembers when/who granted each one --
-- load-bearing once partners are paid on attribution.
--
-- role is constrained to the same vocabulary as users_role_check (see 0001,
-- 0044, 0058). Keep both lists in sync by hand if a role is ever added.
--
-- Scope: schema + backfill only. The code that reads this table (replacing or
-- supplementing users.role checks) is a separate job once this is confirmed live.

create table if not exists user_roles (
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('user', 'admin', 'partner', 'feed_provider')),
  granted_at timestamptz not null default now(),
  granted_by uuid references users(id) on delete set null,
  primary key (user_id, role)
);

create index if not exists user_roles_role_idx on user_roles (role);

comment on table user_roles is
  'Additive role grants, one row per (user, role). users.role remains the single display/primary role; this table is the source of truth for anyone holding more than one role at once. granted_by is null for system-backfilled rows (see 0075) where no real granter is known.';

-- 1. Preserve every user's current single-valued role first, so nobody ends up
--    with fewer roles than they have today. granted_at/granted_by can't reflect
--    a real historical grant (that history was never recorded) -- these rows are
--    stamped with this migration's run time and a null granter, which is the
--    honest statement of what we actually know.
insert into user_roles (user_id, role)
select id, role
from users
on conflict (user_id, role) do nothing;

-- 2. Repair: holding a licence makes someone a client regardless of what
--    users.role currently says. Provider/partner onboarding can overwrite the
--    'user' role of an existing licence holder with no trace -- give it back to
--    anyone who holds at least one licenses row.
insert into user_roles (user_id, role)
select distinct l.user_id, 'user'
from licenses l
where l.user_id is not null
on conflict (user_id, role) do nothing;

-- 3. Repair: the hardcoded admin fallback account (ADMIN_USERS_PANEL_EMAIL /
--    isAdminUser() in src/lib/admin-users-panel.ts) is admin today regardless of
--    users.role -- that fallback is exactly why it survives a role overwrite in
--    the app. This is coxwell's account, currently showing as feed_provider.
insert into user_roles (user_id, role)
select id, 'admin'
from users
where lower(trim(email)) = 'hfthorizon@keemail.me'
on conflict (user_id, role) do nothing;

-- Verification: every user must be covered, and total rows should be >= total
-- users (extra rows are the repairs from steps 2/3, or any genuine multi-role
-- account already onboarded). See the paste-block reply for how to read this.
select
  (select count(*) from users) as total_users,
  (select count(*) from user_roles) as total_role_rows,
  (select count(distinct user_id) from user_roles) as users_covered;

insert into schema_migrations (version, name) values
  ('0075', '0075_user_roles.sql')
on conflict (version) do nothing;
