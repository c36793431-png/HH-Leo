-- The actor scripts/assign-trial.mts stamps on admin_actions (marcus m60729, scope m60728), so
-- "By" on /admin/users/[id] shows marcus-agent@horizonhft.internal rather than coxwell.
-- The CLI refuses to run until this row exists: logAdminAction resolves an unknown actor id to
-- coxwell's row (src/lib/admin.ts resolveAdminUserId), and that is what this row prevents.
-- role 'user' and no user_roles row: it opens no admin page. The .internal address gets no
-- Client # (notAClientSql in src/lib/licenses.ts) and cannot receive a magic link.
-- Idempotent: a re-run inserts nothing and prints the same row.

insert into users (email, display_name, role)
values ('marcus-agent@horizonhft.internal', 'Marcus (agent)', 'user')
on conflict (email) do nothing;

select id, email, role, created_at from users where email = 'marcus-agent@horizonhft.internal';
