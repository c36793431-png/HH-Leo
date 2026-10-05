-- Agent API ledger (marcus m60835 go; scope m60807; fable m60833 C2/C4). One row per EXECUTE
-- request to /api/agent/trial or /api/agent/feed. A plan request writes nothing.
--
-- idempotency_key: chosen by the caller (the claw1 wrapper derives it from route + target + UTC
-- date + params), UNIQUE, so a retry finds its own row and never grants twice.
-- request_hash: sha256 of the normalised payload. The same key with a different payload is a 409.
-- status:
--   pending  inserted and COMMITTED before the grant's lock transaction opens, so a crash leaves
--            it visible. Younger than 2 x maxDuration = in flight (409); older = in doubt, and
--            the next same-key request reconciles it from the database.
--   granted  the grant landed (or reconcile found that it had).
--   refused  a refusal (the panel's rules, or the daily cap). Nothing was written.
--   failed   reconcile found that nothing landed. Retry with a new key.
-- response_json: the trimmed response the route gave (fable C5), replayed on a same-key retry.
-- Never a licence key, Telegram id, server IP or provider email.
-- The daily cap counts pending + granted rows per action since UTC midnight.
--
-- APPLY BEFORE the code that reads this table merges. Rollback: 0095_rollback.sql.
create table if not exists agent_grants (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique
    check (idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  action text not null check (action in ('trial', 'feed')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  request_json jsonb not null,
  -- set null, not cascade: deleting a user must not delete ledger rows (they count toward the cap).
  target_user_id uuid references users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'granted', 'refused', 'failed')),
  response_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_grants_settled_has_response check ((status = 'pending') = (response_json is null))
);

create index if not exists agent_grants_action_created_idx
  on agent_grants (action, created_at desc);

insert into schema_migrations (version, name) values
  ('0095', '0095_agent_grants.sql')
on conflict (version) do nothing;
