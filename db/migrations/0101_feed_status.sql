-- Feed status from a measuring box (FOC13's tommy4 monitor). Plan m64510-2; rulings marcus m64519, m64531, m64552;
-- Fable strikes S1-S3 m64547 + notes m64565; BUILD GO m64545. A box POSTs /api/feed-box/status with the latest state
-- of each feed it measures; the portal keeps the latest row only (no history, Q3) and computes staleness on read
-- from its OWN receive clock (src/lib/feed-status.ts).
--
-- feed_box_status_tiers: the tiers a box may REPORT status for. Separate from feed_box_tiers, which is the set a box
--   APPLIES client IPs for: a status-only box (tommy4) has no feed_box_tiers row, so its token's allowlist is empty
--   (Fable S1). Set by an admin on /admin/feed-boxes.
-- feed_status_latest: one row per (box, tier, symbol) (marcus m64552: one stream can carry two symbols). The FK to
--   feed_box_status_tiers cascades, so taking a tier out of a box's status set drops its rows. CHECKs mirror the
--   route's rules so a hand insert can't hold what the route refuses. box_sent_at is the box's own clock, used ONLY
--   to order reports (an older report never overwrites a newer one, Fable S2); received_at is the portal's clock.
-- feed_boxes gains the whole-box report: status_reported_at (portal clock, the same now() as the rows it wrote),
--   status_sent_at (orders reports at box level), status_measuring + status_collector_version (from the payload's
--   collector), status_ignored (the last report's unknown / out-of-set feed ids, shown on /admin/feed-health, S3).
--   last_seen_at stays the allowlist poll.
-- Additive only. Rollback: 0101_rollback.sql.
create table if not exists feed_box_status_tiers (
  box_id uuid not null references feed_boxes(id) on delete cascade,
  feed_tier_id uuid not null references feed_tiers(id),
  primary key (box_id, feed_tier_id)
);

create index if not exists feed_box_status_tiers_tier_idx on feed_box_status_tiers (feed_tier_id);

create table if not exists feed_status_latest (
  box_id uuid not null,
  feed_tier_id uuid not null,
  symbol text not null check (symbol ~ '^[A-Z0-9._]{1,16}$'),
  source text not null check (source in ('feedcompare', 'bridge_ticks', 'bridge_status')),
  state text not null check (state in ('up', 'stale', 'down', 'closed', 'not_measured')),
  last_tick_at timestamptz,
  ticks_per_min integer check (ticks_per_min is null or ticks_per_min between 0 and 10000000),
  gap_p50_ms integer check (gap_p50_ms is null or gap_p50_ms between 0 and 86400000),
  gap_p99_ms integer check (gap_p99_ms is null or gap_p99_ms between 0 and 86400000),
  box_sent_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key (box_id, feed_tier_id, symbol),
  foreign key (box_id, feed_tier_id) references feed_box_status_tiers (box_id, feed_tier_id) on delete cascade,
  constraint feed_status_latest_not_measured_check check (
    state <> 'not_measured' or (last_tick_at is null and ticks_per_min is null and gap_p50_ms is null and gap_p99_ms is null)
  ),
  constraint feed_status_latest_up_check check (state <> 'up' or last_tick_at is not null)
);

alter table feed_boxes
  add column if not exists status_reported_at timestamptz,
  add column if not exists status_sent_at timestamptz,
  add column if not exists status_measuring boolean,
  add column if not exists status_collector_version text,
  add column if not exists status_ignored jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'feed_boxes_status_collector_version_check') then
    alter table feed_boxes add constraint feed_boxes_status_collector_version_check
      check (status_collector_version is null or status_collector_version ~ '^[0-9]{1,4}(\.[0-9]{1,4}){0,2}$');
  end if;
end $$;

insert into schema_migrations (version, name) values
  ('0101', '0101_feed_status.sql')
on conflict (version) do nothing;
