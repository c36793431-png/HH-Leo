-- Backfill bookkeeping-only: 0054_tier_waitlist.sql was pasted into prod without its
-- schema_migrations insert, so 0055 shows applied while 0054 doesn't (flagged by FOC16,
-- confirmed by coxwell, bus thread leo-partner-page-broken-auth-buttons-2026-08-22). The
-- tier_waitlist table itself already exists live -- this only fixes the tracking row.
insert into schema_migrations (version, name) values
  ('0054', '0054_tier_waitlist.sql')
on conflict (version) do nothing;
