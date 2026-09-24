# N connection endpoints per listing: design

Thread provider-tier-endpoints-2026-09-24, marcus m53770_mufsp7zo. Written by kai, 2026-09-24.
Every file:line below is read at origin/main `e4edea2319d9e767e8264550b229de0f7bb268ff`.
Design only. No code, no migration applied. The .sql beside this file is a candidate for coxwell,
not a file under db/migrations.

Companions: `docs/specs/0091_provider_tier_endpoints.sql`, `docs/specs/0091_rollback.sql`.

## 0. The problem as read from the schema

`provider_tier_proposals` holds `protocol, endpoint_host, endpoint_port, compid` as four nullable
text columns (0061_provider_tier_proposals.sql:21-24). `provider_tiers` holds `endpoint_host,
endpoint_port, endpoint_verified` (0060_provider_tiers.sql:23-25) plus `protocol, compid` added by
0083_provider_tiers_connection_fields.sql:54-55. One row, one address. A provider delivering one
package over two FIX flavours has no second slot.

## 1. Every read and write site of the four columns today

Predicate used for the sweep: `git grep -n -E 'endpoint_host|endpointHost|endpoint_port|endpointPort|compid|\bprotocol\b' origin/main`
over `src` and `db`, then each hit read. Hits on `provider_applications.protocol/host/port/compid`
(0059) and on `black_trials.endpoint` are a different table and are listed only where a render
mixes them in. Refer/partner `protocol` hits are `x-forwarded-proto`, unrelated.

| # | Surface | File:line | R/W | What it does with the four |
|---|---|---|---|---|
| 1 | Terms form (provider) | `src/components/feed/tier-proposal-form.tsx:55-73` | W (UI) | Four single inputs: `protocol`, `compid`, `endpointHost`, `endpointPort`. Hint text at :84-88 states the blank-box refusal rule. |
| 2 | Terms action | `src/app/feed/dashboard/terms/actions.ts:48-51` | W | Trims the four form values to `string \| null`, passes to `submitProposalRound`. |
| 3 | Proposal create | `src/lib/provider-tier-proposals.ts:198-208` (input type), `:214-223` (CONNECTION_FIELDS, label per column), `:243-247` (`connectionFieldsThatWouldClear`), `:308-321` (reads live tier's four + regions/coverage, refuses a blank that would clear), `:323-343` (INSERT of the four) | R+W | The null-overwrite guard is per column; the error message echoes the live values to the provider. |
| 4 | Proposal update | none | - | `provider_tier_proposals` is append-only (0061 header). Only `terms_status/decided_*` are ever updated (`:436`, `:586`). |
| 5 | Confirm copy | `src/lib/provider-tier-proposals.ts:420-427` (SELECT the four FOR UPDATE), `:483-514` (UPDATE branch: `protocol=$5, endpoint_host=$6, endpoint_port=$7, compid=$8`, `endpoint_verified` forced false when host or port `is distinct from` the old row at :494-499), `:516-539` (INSERT branch) | R+W | Replace semantics, null written as null on all four, by design (comment :463-467). |
| 6 | Admin review card | `src/app/admin/providers/[proposalId]/page.tsx` | none | Renders terms only. `getProposalRoundAdmin` (`provider-tier-proposals.ts:72`) and `listProposalRoundsForTierAdmin` (`:92`) select no connection column. The admin confirms a round without seeing the address it will copy. Flagged, section 6. |
| 7 | Admin Connection details view | `src/lib/provider-tiers.ts:112-122` (type), `:158` (`listProviderRoster`), `:185-191` (roster SELECT `t.protocol, t.compid, t.endpoint_host, t.endpoint_port, t.endpoint_verified`), `:229-235` (map); `src/app/admin/providers/page.tsx:77-92` (`pickEndpoint`, host+port resolve together, verified withheld when the endpoint came from the application), `:114-168` (`ConnectionFields`, one Host/Port/CompID/Protocol each), `:178-220` (`ConnectionBlock`, one block per tier, "Connection details" summary at :198) | R | Admin only (`/admin/*`). One endpoint per tier by shape. |
| 8 | Register-provider (admin manual) | `src/components/admin/register-provider-form.tsx:11-22` (TierDraft: one `endpointHost/endpointPort/protocol`, no compid), `:27-39` (defaults host/port from the application), `:243-266` (inputs); `src/app/admin/register-provider/actions.ts:32-66` (`parseTiers`, :60-61 host/port, :63 protocol); `src/lib/provider-tiers.ts:245-262` (RegisterTierInput, no compid on purpose :254-256), `:282` (`registerProviderTiers`), `:321-336` (INSERT `endpoint_host, endpoint_port, endpoint_verified, protocol`) | W | One endpoint per tier. Writes `endpoint_verified` from a checkbox. |
| 9 | Provider's own terms list | `src/app/feed/dashboard/terms/page.tsx:81-117`, backed by `listProposalsForApplicationProvider` (`provider-tier-proposals.ts:163`) | none | Narrow column list, no connection columns. |
| 10 | Buyer joins on provider_tiers | `src/lib/feed-subscriptions.ts:682-690`, `:806-814` | none | `left join provider_tiers pt` reads `pt.tier_name` only. |
| 11 | Marketplace | `src/app/marketplace/[key]/page.tsx:45` | none | Comment: "Host and port are fulfilment detail and never reach this page." Catalogue reads its own tables (`marketplace-catalogue.ts`, `feed-tier-catalogue.ts`), not provider_tiers. |
| 12 | Black trial card | `src/components/account/black-trial-card.tsx:117` | none of the four | Renders `black_trials.endpoint` (`black-trials.ts:106`), a different table, to the trial's own user. Listed so nobody mistakes it for a provider_tiers leak. |

Migration text sites (for the drop, later): 0060:23-25, 0061:21-24, 0083:54-55.

## 2. Schema: child table, not jsonb

Recommendation: two child tables, one per parent, same shape.

- `provider_tier_proposal_endpoints (proposal_id -> provider_tier_proposals)`
- `provider_tier_endpoints (tier_id -> provider_tiers)`, plus `endpoint_verified` per row

Columns per row: `position smallint`, `protocol text`, `endpoint_host text`, `endpoint_port text`,
`compid text`, `notes text`. Port stays text because the parent columns are text today and the
migration must not invent a cast that can fail on data nobody has read.

Why a child table and not jsonb on the parent:

1. `endpoint_verified` is "a claim about this tier's specific endpoint_host:endpoint_port, not
   about the row" (`provider-tiers.ts:117-118`). With N endpoints it is N claims. A boolean per
   child row is that claim in the schema. In jsonb it is a nested flag that the confirm UPDATE
   cannot key `is distinct from` on without unpacking the array in SQL.
2. The null-overwrite guard (`connectionFieldsThatWouldClear`, `:243-247`) becomes a set
   difference: which live endpoints are absent from the submission. Two tables and a
   `not exists` express that; jsonb needs `jsonb_array_elements` on both sides.
3. Uniqueness and non-emptiness are constraints, not app checks: unique `(parent, position)`,
   unique identity on the four values coalesced, `num_nonnulls(...) > 0` per row. jsonb enforces
   shape nowhere, and the repo's rule is that a property nobody enforces is a claim (m51461).
4. Every existing reader is a typed column list by policy (provider-facing lineage comment,
   `provider-tier-proposals.ts:142`: "do not switch to select *"). A child table keeps that;
   a jsonb column would be the one field read as an untyped blob.
5. Cost: one extra `left join` on the roster query and one extra SELECT per confirm. Row counts
   are single digits per parent.

Semantics carried over unchanged, now per set:

- Confirm = replace-set. The confirmed proposal's endpoint rows replace the tier's endpoint rows
  wholesale. An endpoint absent from the round is removed, same as a null is written as null
  today (`:463-467`). No coalesce.
- Verification carry: a new tier endpoint row starts `endpoint_verified = false` unless a
  pre-replace row with the same `(endpoint_host, endpoint_port)` was verified, in which case the
  flag carries. Same identity the UPDATE keys on today (`:495-496`), extended to N.
- Blank-box refusal at submit: refuse when any live tier endpoint, identified by the four values
  coalesced, is absent from the submission; message lists them, same wording pattern as `:318-319`.
  Removing a live endpoint stays Horizon's (SQL by coxwell), unchanged rule, flagged in section 6
  because with N endpoints removal is now an ordinary event, not a mistake.
- Identity for uniqueness: `(parent, coalesce(protocol,''), coalesce(host,''), coalesce(port,''),
  coalesce(compid,''))`, an expression index so it holds on any Postgres version. Two rows that
  differ only in `notes` are one endpoint.
- Order: `position`, 0-based, assigned from array order at submit. App cap of 8 per parent, no DB
  cap.
- The parent's four columns and `endpoint_verified` are NOT dropped by 0091. Reason in section 3.

Backfill: one child row at position 0 per parent row that has any of the four non-null, copying
the four verbatim and, on the tier side, `endpoint_verified`. A parent with all four null gets
no child row; a parent with all four null but `endpoint_verified = true` is counted and printed,
not aborted (the flag claims nothing without a host:port). The Pip Dealer tier `dff16179...`
lands as one child row, its cTrader address; its second address is a later INSERT by coxwell,
template in the .sql header, values not known to me.

## 3. Migration and order of operations

File: `docs/specs/0091_provider_tier_endpoints.sql`. Number 0091 because 0087 is reserved for the
parked feed_tiers connection-fields migration and 0088/0089 sit unapplied on
`kai/tighten-0087-2026-09-12`. If marcus renumbers, only the ledger literal changes.

The migration is additive. Main auto-deploys and coxwell applies SQL out of band, so at the apply
instant the live code still writes the parent columns. Dropping them in 0091 would break the
confirm INSERT/UPDATE and the register-provider INSERT between apply and deploy.

1. Apply 0091 (dry-run with `rollback;` first, paste notices, then real). Old code keeps working.
2. Merge the code branch: every site in section 1 rows 1-3, 5, 7, 8 moves to the child tables,
   reads and writes. Old columns go stale from that instant.
3. Re-run step 4 of 0091 alone, once, after deploy. It is idempotent (`not exists`). It inserts a
   child for any parent row old code created in the window and prints, without changing, any
   tier whose parent values now differ from its single position-0 child (an old-code renegotiation
   confirm in the window). Expected notice: `backfill tiers: inserted 0`, `drift rows: 0`. A
   non-zero drift row is resolved by hand from the printed values, not by the script.
4. 0092, not written: gate child == parent on every row that still has parent scalars, then drop
   the five parent columns.

A trigger mirroring parent writes into the child during the window would close step 3's gap
automatically. Not recommended: a prod trigger is a second writer with no reader in the repo, and
the window is minutes.

Rollback: `docs/specs/0091_rollback.sql` drops the two tables and the ledger row. Loss-free only
before step 2; after step 2 the child tables hold rows the parents never had.

## 4. What a buyer sees

Nothing, today and after. No buyer-facing read of the four columns exists at e4edea2 (section 1
rows 10-12). The only non-admin who sees an endpoint value from these tables is the provider who
owns the application, in the refusal message at `provider-tier-proposals.ts:318-319`, and it is
their own live address, ownership asserted at `:187-194` before the read. The design adds no
buyer reader. The child tables get readers in `provider-tiers.ts` (admin roster) and
`provider-tier-proposals.ts` (submit guard, confirm copy, admin review card) only.

Flag: address secrecy holds by absence of a reader, not by a role check at the query. Any future
"connection details on the buyer's subscription page" is a new control decision, not a render.

## 5. Fail-first test plan

Runner: `npx tsx --test <file>` per `src/lib/tier-request-state.test.ts:1-4`; the repo has no test
script. On my box that invocation was refused on 2026-09-24 (memory: kai box tooling gaps), so
the tests will be written and pushed but I cannot run them here; marcus or Leo runs them. No
scratch DB exists (m53127), so anything below that needs Postgres is a dry-run paste, not a test.

Pure functions, each test written before the function exists so the first run fails on a missing
export, then passes once built:

1. `endpointsThatWouldClear(live, submitted)` in `provider-tier-proposals.ts`, replacing the
   per-column `connectionFieldsThatWouldClear`.
   - live `[A, B]`, submitted `[A]` -> `[B]` described as `protocol host:port compid`.
   - live `[A]`, submitted `[A with different notes]` -> `[]` (notes are not identity).
   - live `[]`, submitted `[]` -> `[]` (first round, nothing to destroy).
   - live `[A]`, submitted `[A, C]` -> `[]` (adding is free).
2. `carryVerification(before, after)`: `[A verified]` -> after `[A, B]` gives A true, B false;
   after `[A with new port]` gives false; after `[]` gives `[]`.
3. `parseEndpointsJson(raw)` for the terms action and register-provider action: drops all-blank
   rows, assigns positions 0..n-1 in order, rejects > 8, rejects a row with only `notes` set.
4. `ConnectionFields` shape: `pickEndpoint` today refuses to compose a tier host with an
   application port (`page.tsx:77-92`). Its N-endpoint successor must render zero tier endpoints
   as the application fallback and one-or-more as the list with no application mixing. A pure
   `resolveEndpointsForDisplay(tierEndpoints, app)` carries the test.

SQL, by dry-run paste (rollback in place of commit):

5. Step 3 census printed before step 4 must show `child rows = 0` on both tables; step 5's gate
   must then pass with `missing 0, drift 0`. To see the gate fail once, run the dry-run with step
   4 commented out: step 5 raises `proposals with scalars but no child row`. That is the check
   that has been seen to fail.
6. Re-run of step 4 on the same dry-run transaction inserts 0 (idempotence).

Merge gates for the code branch: tsc clean, lint at the 3 errors / 4 warnings baseline, the four
test files above passing on a box that can run them, and fable's read of this design first.

## 6. Open for marcus / fable

1. Admin confirms blind today (row 6). The code phase adds the endpoint list to the review card.
   Confirm that is in scope.
2. Removal of a live endpoint stays SQL-by-coxwell under the existing rule. With N endpoints a
   provider dropping one flavour is routine. Keep the rule, or allow removal in the terms form
   with an explicit per-endpoint "remove" tick (refusal stays for the silent case).
3. Register-provider (row 8) gets one endpoint per tier in the code phase, written as position 0.
   Widening that form to N is a separate item unless marcus wants it in the same branch.
4. `notes` is free text per endpoint and is admin-visible only. Confirm no provider-side render.
5. Number 0091 and the docs/specs location until fable passes.

## 7. Files the code phase would touch (declaration, not yet opened)

`src/lib/provider-tier-proposals.ts`, `src/lib/provider-tiers.ts`, `src/app/admin/providers/page.tsx`,
`src/app/admin/providers/[proposalId]/page.tsx`, `src/app/feed/dashboard/terms/actions.ts`,
`src/components/feed/tier-proposal-form.tsx`, `src/app/admin/register-provider/actions.ts`,
`src/components/admin/register-provider-form.tsx`, new `src/lib/provider-tier-endpoints.ts` and
its `.test.ts`, `db/migrations/0091_provider_tier_endpoints.sql` + rollback moved from docs/specs.
None of these is `server-registration.ts` or ip-history.
