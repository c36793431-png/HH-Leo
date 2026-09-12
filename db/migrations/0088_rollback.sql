-- Companion to 0087_feed_tiers_connection_fields.sql. NOT applied automatically by that migration,
-- and NOT applied at all yet -- 0087 itself is unapplied as of writing.
--
-- Reverses 0087 in the opposite order: the four columns, then the ledger row. Each statement is
-- idempotent on its own (`if exists` / a version-filtered delete), so a re-run after a partial
-- failure is safe.
--
-- THIS IS DESTRUCTIVE ONCE A PROVIDER HAS TYPED ANYTHING IN. While 0087 is fresh every column is
-- null and dropping them loses nothing. The moment the Feeds tab's edit control has been used, each
-- dropped column takes those host/port/protocol/compid values with it, and there is NO other copy:
-- these are the only columns in the schema that hold a house-catalogue tier's connection details,
-- and nothing mirrors them to provider_tiers, provider_tier_proposals or provider_applications.
-- Check for non-null values before running this:
--
--   select count(*) from feed_tiers
--   where protocol is not null or endpoint_host is not null
--      or endpoint_port is not null or compid is not null;
--
-- Dropped in one statement so a reversal cannot leave feed_tiers carrying two of the four and
-- reading as a half-configured endpoint -- the same all-or-nothing reason 0087 adds them together.

alter table feed_tiers
  drop column if exists protocol,
  drop column if exists endpoint_host,
  drop column if exists endpoint_port,
  drop column if exists compid;

delete from schema_migrations where version = '0087';
