# N connection endpoints per listing: design

Thread provider-tier-endpoints-2026-09-24, marcus m53770_mufsp7zo. Written by kai, 2026-09-24.
Revised 2026-09-25 for fable's design ruling, relayed verbatim by marcus at m53845_mugcb7oa:
DESIGN PASS WITH STRIKES S1 (carry key), S2 (dual-write, 0092 gate, no guards, rollback order),
S3 (one reader with a viewer assert, grep gate); (a)-(e) ruled; notes N1-N5. Each strike is
marked `[S1]` etc. where it lands below.
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
| 6 | Admin review card | `src/app/admin/providers/[proposalId]/page.tsx` | none | Renders terms only. `getProposalRoundAdmin` (`provider-tier-proposals.ts:72`) and `listProposalRoundsForTierAdmin` (`:92`) select no connection column. The admin confirms a round without seeing the address it will copy. Ruled a defect, section 6 item 1. |
| 7 | Admin Connection details view | `src/lib/provider-tiers.ts:112-122` (type), `:158` (`listProviderRoster`), `:185-191` (roster SELECT `t.protocol, t.compid, t.endpoint_host, t.endpoint_port, t.endpoint_verified`), `:229-235` (map); `src/app/admin/providers/page.tsx:77-92` (`pickEndpoint`, host+port resolve together, verified withheld when the endpoint came from the application), `:114-168` (`ConnectionFields`, one Host/Port/CompID/Protocol each), `:178-220` (`ConnectionBlock`, one block per tier, "Connection details" summary at :198) | R | Admin only (`/admin/*`). One endpoint per tier by shape. |
| 8 | Register-provider (admin manual) | `src/components/admin/register-provider-form.tsx:11-22` (TierDraft: one `endpointHost/endpointPort/protocol`, no compid), `:27-39` (defaults host/port from the application), `:243-266` (inputs); `src/app/admin/register-provider/actions.ts:32-66` (`parseTiers`, :60-61 host/port, :63 protocol); `src/lib/provider-tiers.ts:245-262` (RegisterTierInput, no compid on purpose :254-256), `:282` (`registerProviderTiers`), `:321-336` (INSERT `endpoint_host, endpoint_port, endpoint_verified, protocol`) | W | One endpoint per tier. Writes `endpoint_verified` from a checkbox. |
| 9 | Provider's own terms list | `src/app/feed/dashboard/terms/page.tsx:81-117`, backed by `listProposalsForApplicationProvider` (`provider-tier-proposals.ts:163`) | none | Narrow column list, no connection columns. |
| 10 | Buyer joins on provider_tiers | `src/lib/feed-subscriptions.ts:682-690`, `:806-814` | none | `left join provider_tiers pt` reads `pt.tier_name` only. |
| 11 | Marketplace | `src/app/marketplace/[key]/page.tsx:45` | none | Comment: "Host and port are fulfilment detail and never reach this page." Catalogue reads its own tables (`marketplace-catalogue.ts`, `feed-tier-catalogue.ts`), not provider_tiers. |
| 12 | Black trial card | `src/components/account/black-trial-card.tsx:117` | none of the four | Renders `black_trials.endpoint` (`black-trials.ts:106`), a different table, to the trial's own user. Listed so nobody mistakes it for a provider_tiers leak. |

Migration text sites (for the drop, later): 0060:23-25, 0061:21-24, 0083:54-55.

## 2. Schema: child table, not jsonb

Ruled GO (fable via m53845). Two child tables, one per parent, same shape.

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
3. Uniqueness, non-emptiness and the cap are constraints, not app checks: unique
   `(parent, position)`, unique identity on the four values coalesced, `num_nonnulls(...) > 0`
   per row, `position between 0 and 7` per row `[N2]`. jsonb enforces shape nowhere, and the
   repo's rule is that a property nobody enforces is a claim (m51461).
4. Every existing reader is a typed column list by policy (provider-facing lineage comment,
   `provider-tier-proposals.ts:142`: "do not switch to select *"). A child table keeps that;
   a jsonb column would be the one field read as an untyped blob.
5. Cost: one extra `left join` on the roster query and one extra SELECT per confirm. Row counts
   are single digits per parent.

### 2.1 Row identity, and the two keys that are not the same key `[S1]`

Row identity is the four values coalesced to `''`:
`(parent, coalesce(protocol,''), coalesce(host,''), coalesce(port,''), coalesce(compid,''))`,
enforced by a unique expression index so it holds on any Postgres version. Two rows that differ
only in `notes` are one endpoint. This is the ONLY row identity in the design; the carry rule
below keys on it and nothing else, so there is one identity, not two.

- **Verification carry keys on the full four-tuple.** A new tier endpoint row starts
  `endpoint_verified = false` unless a pre-replace row with the same `(protocol, host, port,
  compid)`, null equal to null via coalesce, was verified, in which case the flag carries.
  Why: a FIX logon is an address plus a session identity, so a verified claim does not survive a
  compid or protocol change; under a `(host, port)` key, one gateway host:port serving a BJF and
  a cTrader session (different compid) would let the unverified session inherit the verified
  session's flag, a false claim on an address nobody logged on to. It also removes the case where
  one verified pre-replace row matches two submitted rows.
- **Tightening versus today, stated on purpose.** Today's UPDATE (`:494-499`) resets
  `endpoint_verified` only when host or port changes, so a compid-only edit keeps `verified =
  true`. That loosening is NOT ported: a compid-only or protocol-only edit re-verifies.
- **The submit-time removal guard keys on `(host, port)`.** Refuse when any live tier endpoint's
  `(endpoint_host, endpoint_port)` is absent from the submission's set of `(host, port)`; the
  message lists the missing addresses, same wording pattern as `:318-319`. Why: its one job is to
  refuse silent removal of an address, and a compid or protocol edit at the same address is an
  edit, not a removal.
- **Do not harmonise these two keys.** The carry key answers "is this the same session the admin
  logged on to" and must be the four; the removal guard answers "did an address disappear" and
  must be the address. Making the guard the four would refuse every compid edit as a removal;
  making the carry the address would carry a claim across sessions.
- Consequence flagged, not ruled: today's per-column guard (`:243-247`) also refuses a blank
  `protocol` or `compid` that would clear a live value. Under the `(host, port)` guard, a row
  resubmitted at the same address with compid blank is an edit and passes; the row lands with
  compid null and `verified = false` (carry misses on the four). That is the ruled shape; noted
  here so the change from today's per-column refusal is visible.

### 2.2 Semantics carried over, now per set

- Confirm = replace-set, implemented as **delete-then-insert inside the confirm's existing FOR
  UPDATE transaction** `[N3]`: snapshot the tier's live endpoint rows (four + verified), delete
  them, insert the proposal's rows at their submitted positions, and compute carry from the
  pre-delete snapshot by the four-tuple. Never upsert-by-position: a position shift would re-key
  verification to the wrong row. An endpoint absent from the round is removed, same as a null is
  written as null today (`:463-467`). No coalesce.
- Removal path in this cut is unchanged from today: a provider submitting a set without a live
  address is refused by the guard; the removal is SQL by coxwell. A per-row "remove" tick on the
  terms form is logged as a follow-up (section 6 item 2), not built here.
- Order: `position`, 0-based, assigned from array order at submit. Cap 8 per parent, enforced by
  the DB check `position between 0 and 7` `[N2]` and mirrored in the app parser so the error is
  readable.
- `notes` is **provider-authored** on the proposal form, one free-text field per endpoint row,
  copied to the tier row at confirm with the other columns `[ruling (d)]`. Rendered on the admin
  review card and the admin Connection details block only; never to a buyer, never in the
  refusal echo to the provider (the echo lists addresses, not notes). Reason for provider
  authorship: the note is what tells the admin which session an address is ("BJF session",
  "cTrader session"), which is exactly what the verifier needs and only the provider knows.
- Register-provider (row 8) writes position 0 only; its checkbox becomes that row's
  `endpoint_verified`; compid stays absent there, today's shape `[ruling (c)]`.
- The parent's four columns and `endpoint_verified` are NOT dropped by 0091 and are kept current
  by dual-write until 0092. Reason in section 3.

Backfill: one child row at position 0 per parent row that has any of the four non-null, copying
the four verbatim and, on the tier side, `endpoint_verified`. A parent with all four null gets
no child row; a parent with all four null but `endpoint_verified = true` is counted and printed,
not aborted (the flag claims nothing without a host:port). `[N1]` The census also prints every
proposal whose four are all null while the tier it would confirm into (same `application_id`,
`tier_name`) carries an address, so nothing is silently lost. The Pip Dealer tier `dff16179...`
lands as one child row, its cTrader address; its second address is a later INSERT by coxwell,
template in the .sql header, values not known to me.

## 3. Migration and order of operations `[S2]`

File: `docs/specs/0091_provider_tier_endpoints.sql`. Number 0091 per marcus m53796 (0090 is
Leo's ip-history 1b); the drop is 0092. If marcus renumbers, only the ledger literals change.

The migration is additive. Main auto-deploys and coxwell applies SQL out of band, so at the apply
instant the live code still writes the parent columns. Dropping them in 0091 would break the
confirm INSERT/UPDATE and the register-provider INSERT between apply and deploy.

1. Apply 0091 (dry-run with `rollback;` first, paste notices, then real). Old code keeps working.
2. Merge the code branch: every site in section 1 rows 1-3, 5, 7, 8 moves to the child tables,
   reads and writes. **Dual-write:** until 0092 lands, submit, confirm and register write the
   child rows AND mirror position 0 (the four columns, plus `endpoint_verified` on the tier side)
   to the parent columns in the same transaction. A parent with zero child rows gets all-null
   parent columns and `endpoint_verified = false`. Without the mirror, every confirm between
   merge and 0092 leaves the parents stale, step 3's drift count is not 0, the 0092 gate fails
   legitimately, and any reader not yet cut over reads a stale address; with it, step 3 is a real
   zero-check and the rollback stays reproducible-from-parents for position 0.
3. Re-run step 4 of 0091 alone, once, after deploy. It is idempotent (`not exists`). It inserts a
   child for any parent row old code created in the window and prints, without changing, any
   tier whose parent values differ from its position-0 child (an old-code confirm in the
   (i)..(ii) window that the dual-write did not see). Expected notice:
   `backfill tiers: inserted 0`, `drift rows: 0`. A non-zero drift row is printed with both sides
   verbatim and resolved by hand, not by the script `[N4]`.
4. 0092, not written, gate is **position 0 only**: for every parent, the child row at position 0
   equals the parent four (coalesce both sides) and `endpoint_verified` on the tier side; and
   parent all-null <=> zero child rows. NOT child == parent over all rows: the Pip Dealer
   hand-inserted second row and every N-endpoint listing would fail an all-rows gate by design.
   Then drop the five parent columns and delete the dual-write mirror from the code in the same
   merge-then-apply pair (reverse order of 0091: code that stops writing the columns can only
   deploy after nothing reads them, so 0092's code change is reads first, then the drop, then
   the writer cleanup).

Merge order is a **process gate, not a code guard**: the code PR does not merge until coxwell's
apply notices for 0091 are on the bus (main auto-deploys, so merge == deploy). No `42P01`
undefined-table guards on the writers: a swallowed error there drops endpoints silently, the same
rule as ip-history 1b. No guards on the readers either: pre-apply the admin pages would 500,
which is the correct loud failure for a wrong-order deploy.

A trigger mirroring parent writes into the child during the window would close step 3's gap
automatically. Not recommended: a prod trigger is a second writer with no reader in the repo, and
the window is minutes.

Rollback: `docs/specs/0091_rollback.sql` drops the two tables and the ledger row. Loss-free only
before step 2. After step 2 the code revert comes FIRST (its header says so): revert the code
branch, wait for the deploy, then run the rollback. With the dual-write, position-0 rows are then
reproducible from the parents; every row at position >= 1 and every non-null `notes` is not, and
the rollback's count check refuses in that case for coxwell to decide by hand.

## 4. What a buyer sees, and the one reader `[S3]`

Nothing, today and after. No buyer-facing read of the four columns exists at e4edea2 (section 1
rows 10-12). The only non-admin who sees an endpoint value from these tables is the provider who
owns the application, in the refusal message at `provider-tier-proposals.ts:318-319`, and it is
their own live address, ownership asserted at `:187-194` before the read. The design adds no
buyer reader.

Fable accepted the flag that secrecy holds by absence of a reader, and ruled the closer. The
code phase builds it:

- **One reader.** All SELECTs on `provider_tier_endpoints` and `provider_tier_proposal_endpoints`
  live in the new module `src/lib/provider-tier-endpoints.ts`, behind a reader that takes the
  viewer and asserts, before the SELECT, that the viewer is an admin or the owning provider of
  every parent requested (reusing the `assertOwnsApplication` shape at `:187-194`: re-check
  ownership from the row, never from a posted id). The admin roster (row 7), the admin review
  card (row 6), the submit guard and the confirm copy (rows 3, 5) all read through it. The
  module also owns the writers (proposal insert, tier replace-set with carry, and the position-0
  parent mirror of section 3) so that no other file names the tables or the columns.
- **Grep gate, review-time.** After the code phase,
  `git grep -n "provider_tier_endpoints\|provider_tier_proposal_endpoints\|endpoint_host"` must
  hit only `src/app/admin/`, `src/app/feed/dashboard/terms/`, `src/app/admin/register-provider/`,
  `src/lib/provider-tier-endpoints.ts`, and SQL text under `db/migrations/` and `docs/specs/`.
  Baseline at e4edea2 (read on 2026-09-25): 3 hits in `db/migrations`, 1 in
  `src/app/admin/providers/page.tsx:72` (a comment), 15 in `src/lib/provider-tier-proposals.ts`,
  5 in `src/lib/provider-tiers.ts`. The two `src/lib` files must reach zero hits: every SQL that
  names these columns moves into the module. Any new hit outside the allowed set is a review
  failure, not a judgement call.
- **Fail-first test.** The reader called with a viewer who is neither admin nor the owning
  provider throws before any query runs. Then secrecy is a check at the query, not a hope about
  page.tsx. Any future "connection details on the buyer's subscription page" is a new control
  decision that has to change the assert, not a render.

## 5. Fail-first test plan

Runner: `npx tsx --test <file>` per `src/lib/tier-request-state.test.ts:1-4`; the repo has no test
script. On my box that invocation was refused on 2026-09-24 (memory: kai box tooling gaps), so
the tests will be written and pushed but I cannot run them here; marcus or Leo runs them. No
scratch DB exists (m53127), so anything below that needs Postgres is a dry-run paste, not a test.
Unrun tests are not a PASS input `[N5]`.

Pure functions, each test written before the function exists so the first run fails on a missing
export, then passes once built:

1. `endpointsThatWouldClear(live, submitted)` in `provider-tier-endpoints.ts`, keyed on
   `(host, port)`, replacing the per-column `connectionFieldsThatWouldClear`.
   - live `[A, B]`, submitted `[A]` -> `[B]` described as `host:port`.
   - live `[A]`, submitted `[A with different notes]` -> `[]` (notes are not identity).
   - live `[A]`, submitted `[A with different compid]` -> `[]` (an edit, not a removal).
   - live `[]`, submitted `[]` -> `[]` (first round, nothing to destroy).
   - live `[A]`, submitted `[A, C]` -> `[]` (adding is free).
2. `carryVerification(before, after)`, keyed on the four coalesced:
   - `[A verified]` -> after `[A, B]` gives A true, B false.
   - after `[A with new port]` gives false.
   - after `[A with new compid]` gives false (the S1 tightening; today's UPDATE would keep true).
   - after `[A with compid null]` where before had compid null gives true (null == null).
   - `[A verified, B verified]` at one host:port with different compids -> after `[B]` gives B
     true only; after `[C at that host:port, third compid]` gives false.
   - after `[]` gives `[]`.
3. `parseEndpointsJson(raw)` for the terms action and register-provider action: drops all-blank
   rows, assigns positions 0..n-1 in order, rejects 9 rows, rejects a row with only `notes` set.
4. `ConnectionFields` shape: `pickEndpoint` today refuses to compose a tier host with an
   application port (`page.tsx:77-92`). Its N-endpoint successor must render zero tier endpoints
   as the application fallback and one-or-more as the list with no application mixing. A pure
   `resolveEndpointsForDisplay(tierEndpoints, app)` carries the test.
5. Reader assert `[S3]`: the reader with a non-owner non-admin viewer throws; with the owning
   provider it proceeds; with an admin it proceeds. The assert is a pure predicate over
   `(viewer, ownerUserId, isAdmin)` so the throw is testable without Postgres.

SQL, by dry-run paste (rollback in place of commit):

6. Step 3 census printed before step 4 must show `child rows = 0` on both tables; step 5's gate
   must then pass with `missing 0, drift 0`. To see the gate fail once, run the dry-run with step
   4 commented out: step 5 raises `proposals with scalars but no child row`. That is the check
   that has been seen to fail.
7. Re-run of step 4 on the same dry-run transaction inserts 0 (idempotence).
8. Cap: an `insert ... position 8` in the dry-run must raise on
   `provider_tier_endpoints_position_check` `[N2]`.

Merge gates for the code branch: tsc clean, lint at the 3 errors / 4 warnings baseline, the
test files above passing on a box that can run them, the grep gate of section 4 at zero hits
outside the allowed set, fable's pass on the 0091 .sql, and coxwell's apply notices on the bus.

## 6. Rulings (fable via marcus m53845) and follow-ups

1. Admin confirms blind today (row 6): a defect, not new scope. The review card lists every
   endpoint row of the round with its verified state and which rows will carry.
2. Removal: replace-set, no partial removal in this cut. Follow-up logged: a per-row "remove"
   tick on the terms form so a routine flavour drop does not need coxwell SQL. Not built here.
3. Register-provider: position 0 only, checkbox = that row's `endpoint_verified`, no compid.
4. `notes`: provider-authored on the proposal form, admin-only render, never buyer, never in the
   refusal echo (section 2.2).
5. Numbering 0091/0092 and docs/specs location: per m53796, superseded fable's (e).

Open: none from the design. The .sql review is its own turn (paste with md5); the code phase
starts only after fable passes the .sql.

## 7. Files the code phase would touch (declaration, not yet opened)

`src/lib/provider-tier-proposals.ts`, `src/lib/provider-tiers.ts`, `src/app/admin/providers/page.tsx`,
`src/app/admin/providers/[proposalId]/page.tsx`, `src/app/feed/dashboard/terms/actions.ts`,
`src/components/feed/tier-proposal-form.tsx`, `src/app/admin/register-provider/actions.ts`,
`src/components/admin/register-provider-form.tsx`, new `src/lib/provider-tier-endpoints.ts` and
its `.test.ts`, `db/migrations/0091_provider_tier_endpoints.sql` + rollback moved from docs/specs.
None of these is `server-registration.ts` or ip-history.
