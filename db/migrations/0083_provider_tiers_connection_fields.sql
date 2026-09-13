-- APPLIED 2026-09-10 ~20:10Z by marcus, as an explicit transaction, after coxwell ruled at
-- 20:04Z that the SQL pastes were marcus's to run. This header previously read "NOT APPLIED --
-- do not run against prod"; corrected here so it doesn't mislead a future reader, same as
-- 0081's header. Verified at the objects, not the ledger: provider_tiers now carries
-- protocol text, compid text, regions ARRAY, coverage ARRAY -- all four nullable, no defaults;
-- '0083' present in schema_migrations.
--
-- The ordering gate this header used to carry -- "must be applied before any copy-forward code
-- (e.g. confirmProposalRound carrying protocol/compid/regions/coverage into provider_tiers) is
-- merged, columns first, code second" -- is now SATISFIED, not dropped. The columns exist, so
-- that copy-forward is no longer blocked on this file (marcus, m47659). It is now PARTLY built:
-- confirmProposalRound (src/lib/provider-tier-proposals.ts) carries protocol/endpoint_host/
-- endpoint_port/compid forward in both its update and insert branches, per marcus's split go
-- (m47739/m47740, 2026-09-10). regions/coverage are still NOT carried -- held by marcus, not
-- forgotten. See the note at the bottom of this header for why that hold's stated premise does
-- not actually apply to this path.
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
-- included) from that source is a separate call, not made by this migration. RULED 2026-09-10
-- (marcus, m47740): no automatic backfill from provider_applications, ever -- hand-registered
-- rows get their connection details entered through the registration surface. Null is honest;
-- a comma-split guess is not. Confirmed by the live data: the only two provider_applications
-- rows have regions null and coverage values that disagree on delimiter outright
-- ('FX,COmmodities' vs 'FX Majors - Metals - Indices - BTC'), so no single split rule is right.
--
-- Do not read that ruling as also blocking regions/coverage on the confirmProposalRound path.
-- They are different tables: the copy-forward's source is provider_tier_proposals (0061), where
-- both columns are already text[] -- verified in the catalogue, udt_name '_text' -- so that copy
-- needs no split rule at all. The free text is on provider_applications (0059) only.
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
