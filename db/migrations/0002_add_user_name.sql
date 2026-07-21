-- Auth.js Email/Resend adapter writes `name` on first sign-in; missing column 500s the callback.
alter table users add column if not exists name text;
