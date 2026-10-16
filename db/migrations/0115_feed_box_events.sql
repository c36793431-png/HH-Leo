-- Feed-box EVENTS: the Pip CME bridge's Databento cuts and errors, bridge starts/stops and client connects/rejects,
-- for /admin/feed-health (S1) and later the provider's /feed/dashboard/health (S2). Plan m70008-10; rulings marcus
-- m70015 (Q1-Q7) + m70036 (databento_error, the 8th kind); Fable PASS WITH STRIKES m70029; BUILD GO m70031. A box POSTs
-- /api/feed-box/events with the box token (src/lib/feed-box-events.ts). Events never refresh freshness: the box's
-- clock stays feed_boxes.status_reported_at (0101, E5).
--
-- feed_box_events: one row per (box, ts, kind), the box's own log ts. A cut may be sent twice, open (duration_s null)
--   then closed with the same ts: the write sets duration_s only on an open row, so a replay can't re-time or reopen a
--   closed cut (E2). kind is text + CHECK, as 0101 (adding a kind = one constraint swap). detail is a closed code with
--   no digits, dots or colons, so an IP, a login or a token has nowhere to ride (Q2). The pk serves "box X, newest
--   first, last 24 h", so there is no other index. Retention 30 d: the write deletes the box's older rows, every read
--   filters (E4). No cron.
-- feed_boxes.events_ignored: the last events POST's skipped events (ts, kind, reason), shown on the admin box header
--   as status_ignored is (Fable m70029 N5: a box clock > 60 s ahead has EVERY event skipped).
-- Additive only. Rollback: 0115_rollback.sql.
create table if not exists feed_box_events (
  box_id uuid not null references feed_boxes(id) on delete cascade,
  ts timestamptz not null,
  kind text not null check (kind in ('databento_silent', 'databento_error', 'reconnect_ok', 'bridge_start', 'bridge_stop',
                                     'client_reject', 'client_connect', 'client_disconnect')),
  duration_s integer check (duration_s is null or duration_s between 0 and 86400),
  detail text check (detail is null or detail ~ '^[a-z_]{1,32}$'),
  received_at timestamptz not null default now(),
  primary key (box_id, ts, kind),
  constraint feed_box_events_duration_kind_check check (duration_s is null or kind = 'databento_silent')
);

alter table feed_boxes
  add column if not exists events_ignored jsonb;

insert into schema_migrations (version, name) values
  ('0115', '0115_feed_box_events.sql')
on conflict (version) do nothing;
