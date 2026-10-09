-- Feed auto-provision, portal side (coxwell GO 2026-10-09 16:4xZ via marcus m62546; design = Fable's ruling
-- m62433 + addenda, token scope and record id ruled by marcus m62718). A provider box (the CME bridge box first)
-- PULLS the effective-active client IP set from the portal every ~60 s and writes back what it applied. The portal
-- holds no box credential and never pushes; the box holds a per-box bearer token and refuses what it doesn't like.
--
-- feed_boxes: one row per provider box. The bearer token is 32 random bytes shown ONCE to the admin who issues it;
--   only its sha256 (hex) is stored, never the token. serial is bumped on every allowlist response, so the box can
--   refuse a replayed or stale body (serial <= last applied). A box is NOT a server_registration: those are client
--   servers, and one CME box serves every CME client (marcus m62718 Q1).
-- feed_box_tiers: the tier set a box serves; the allowlist is every effective-active record on these tiers.
-- feed_allowlist_records (0086 section 5) gains:
--   id: the record_id the box writes back against (the PK is composite and has no id; marcus m62718 Q2). Existing
--       rows get one each (gen_random_uuid() is volatile, so the add fills every row with its own value).
--   applied_at / applied_by / apply_result / apply_reason: the box's write-back. applied_by is always
--       'box:<feed_boxes.name>' so a machine write never looks like a human one. told_at stays the human tick,
--       untouched (Fable m62433 item 1).
--   revoked_by: who wrote revoked_at ('expiry-job' for the job below; NULL on rows revoked before this).
--   lapse_seen_at: the expiry job's first sighting of an open record whose subscription is no longer live. The 3-day
--       grace counts from here, so turning the job on can never revoke a backlog in one run; cleared if the record
--       is live again. The job writes NOTHING unless AUTOPROVISION_EXPIRY_ENABLED=true (off everywhere at ship).
-- Additive only: two new tables, nullable columns plus a filled id. Rollback: 0098_rollback.sql.
create table if not exists feed_boxes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  token_sha256 text unique check (token_sha256 is null or token_sha256 ~ '^[0-9a-f]{64}$'),
  serial bigint not null default 0,
  rotated_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists feed_box_tiers (
  box_id uuid not null references feed_boxes(id) on delete cascade,
  feed_tier_id uuid not null references feed_tiers(id),
  primary key (box_id, feed_tier_id)
);

create index if not exists feed_box_tiers_tier_idx on feed_box_tiers (feed_tier_id);

alter table feed_allowlist_records
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists applied_at timestamptz,
  add column if not exists applied_by text,
  add column if not exists apply_result text,
  add column if not exists apply_reason text,
  add column if not exists revoked_by text,
  add column if not exists lapse_seen_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'feed_allowlist_records_id_key') then
    alter table feed_allowlist_records add constraint feed_allowlist_records_id_key unique (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feed_allowlist_records_apply_result_check') then
    alter table feed_allowlist_records add constraint feed_allowlist_records_apply_result_check
      check (apply_result is null or apply_result in ('applied', 'pending_bridge_reload', 'rejected', 'removed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feed_allowlist_records_applied_by_check') then
    alter table feed_allowlist_records add constraint feed_allowlist_records_applied_by_check
      check (applied_by is null or applied_by ~ '^box:[a-z0-9][a-z0-9-]{1,39}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feed_allowlist_records_apply_reason_check') then
    alter table feed_allowlist_records add constraint feed_allowlist_records_apply_reason_check
      check (apply_reason is null or length(apply_reason) <= 300);
  end if;
end $$;

insert into schema_migrations (version, name) values
  ('0098', '0098_feed_autoprovision.sql')
on conflict (version) do nothing;
