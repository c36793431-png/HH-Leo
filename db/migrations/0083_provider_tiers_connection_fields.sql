-- NOT APPLIED -- do not run against prod. Prepared by leo for coxwell to paste manually.
-- Must be applied before any copy-forward code (e.g. confirmProposalRound carrying
-- protocol/compid/regions/coverage into provider_tiers) is merged -- columns first, code
-- second, confirmed only after coxwell reports the SQL actually ran.
-- Bus thread leo-provider-self-registration-scope-2026-09-10, marcus's ruling (m47224/m47227):
-- migration, not a join through provider_tier_proposals, for the admin Connection block on
-- /admin/providers. Reason: the manual admin/register-provider path (registerProviderTiers,
-- src/lib/provider-tiers.ts) writes provider_tiers directly and never inserts a
-- provider_tier_proposals row -- confirmed by reading that function, 2026-09-10. A join-based
-- Connection block would render empty for every manually-registered provider, including
-- Black FastFeed, which coxwell is hand-registering right now. provider_tiers stays the
-- self-sufficient record of confirmed truth; these four columns close the only gap between it
-- and provider_tier_proposals (0061), which already carries them.
--
-- Types match provider_tier_proposals exactly (protocol/compid text, regions/coverage
-- text[]) so a future copy-forward in confirmProposalRound (see below) is a straight column
-- copy, no cast. All four nullable -- every existing provider_tiers row (register-provider
-- rows and confirmed-round rows alike) predates this column set, so there is no correct
-- non-null default to backfill from within this migration.
--
-- NOT done here, flagged for a separate decision: provider_applications (0059) already holds
-- protocol/compid/regions/coverage for manually-registered providers (registerProviderTiers
-- writes them there, not to provider_tiers) -- but as free-text regions/coverage columns, not
-- text[], so copying them into these new columns is a lossy type conversion, not a straight
-- backfill. Whether/how to backfill existing manually-registered rows (Black FastFeed
-- included) from that source is a separate call, not made by this migration.
--
-- host+port without protocol is not a connectable endpoint (marcus's all-or-nothing read,
-- m47224) -- accepted here, hence all four columns in one migration rather than a partial add.

alter table provider_tiers
  add column if not exists protocol text,
  add column if not exists compid text,
  add column if not exists regions text[],
  add column if not exists coverage text[];

insert into schema_migrations (version, name) values
  ('0083', '0083_provider_tiers_connection_fields.sql')
on conflict (version) do nothing;
