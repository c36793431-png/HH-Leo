-- Migration 0057: pending_signups staging table
--
-- The email/magic-link signup flow (NextAuth Resend provider) only creates the
-- `users` row when the link is clicked, not at form-submit time — so a name or
-- telegram handle typed on the signup form has nowhere to land yet. This table
-- stashes that input keyed by email; the `createUser` event reads it back,
-- backfills `users.name` / `users.telegram_username`, and deletes the row.
create table if not exists pending_signups (
  email text primary key,
  name text,
  telegram_handle text,
  created_at timestamptz not null default now()
);
