-- Marketplace request basket (coxwell 2026-10-03 23:26Z via marcus m59124; storage ruled in
-- m59146, thread marketplace-basket-2026-10-03). A client picks software, strategies and feeds
-- and sends them as ONE request. A submit grants nothing: coxwell gets one approvals-topic card,
-- fulfils by hand with the existing admin tools, then marks the request handled.
--
-- This is NOT an approval object. 'handled' means "coxwell has dealt with it", never an outcome,
-- and nothing reads it to grant anything. The per-feed Request access envelope (access_requests,
-- 0086) stays the only tracked approval path; a basket writes no envelope.
--
-- lines: a snapshot taken at submit, an array of 1..20
--   {kind: 'software'|'strategy'|'feed', key, name, note?}
-- Nothing joins on a line and status is per request, so no child table.
-- has_trial: the client chose the basket-level "Start with a 30-day trial". At most one such row
-- per account (partial unique index), so a double submit can't hold two trial requests.
-- telegram_handle: where to reply, typed on the review step only when the account has no
-- Telegram on file (users.telegram_user_id / telegram_username both empty). Never written back
-- to users.
--
-- APPLY BEFORE the code that reads this table merges. Rollback: 0093_rollback.sql.
create table if not exists basket_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  lines jsonb not null
    check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 20),
  has_trial boolean not null default false,
  telegram_handle text check (telegram_handle is null or length(telegram_handle) between 2 and 64),
  status text not null default 'new' check (status in ('new', 'handled')),
  handled_at timestamptz,
  handled_by uuid references users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  constraint basket_requests_handled_stamp check ((status = 'handled') = (handled_at is not null))
);

create index if not exists basket_requests_status_submitted_idx
  on basket_requests (status, submitted_at desc);
create index if not exists basket_requests_user_idx
  on basket_requests (user_id, submitted_at desc);
create unique index if not exists basket_requests_one_trial_per_user_uidx
  on basket_requests (user_id) where has_trial;

insert into schema_migrations (version, name) values
  ('0093', '0093_basket_requests.sql')
on conflict (version) do nothing;
