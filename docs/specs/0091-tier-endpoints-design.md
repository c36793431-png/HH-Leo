# N connection endpoints per listing: design

Thread provider-tier-endpoints-2026-09-24, marcus m53770_mufsp7zo. Written by kai, 2026-09-24.
Revised 2026-09-25 for fable's design ruling, relayed verbatim by marcus at m53845_mugcb7oa:
DESIGN PASS WITH STRIKES S1 (carry key), S2 (dual-write, 0092 gate, no guards, rollback order),
S3 (one reader with a viewer assert, grep gate); (a)-(e) ruled; notes N1-N5. Each strike is
marked `[S1]` etc. where it lands below. Revised again 2026-09-25 for fable's .sql verdict
(m53885 via marcus m53887, one strike, section 2.1 nonempty check) and for fable's ruling on the
flagged blank-compid consequence (m53894 via marcus m53896: REFUSE THE BLANK, section 2.1 clauses
1 and 2, section 5 test plan 2). Revised again 2026-09-25 for fable's design verdict on dc79b31
(m53938 via marcus m53940: PASS WITH STRIKES, all text): S1 an endpoint row requires host and port
(2.1, 5.3), S2 the 0092 order (3 step 4), S3 the grep gate split into two patterns (4), and her
note N2 (2.2). Revised 2026-09-25 at code delta 4, text only, for the items the code-phase
reviews left owed to the first .md touch: fable's design-pass note N1 (6 item 7, m53977 via
marcus m53979), the delta-1 strike S1 count-per-address (2.1, m54026 via m54028), the delta-2
plan ruling J3 (2.2, m54043 via m54049), and the FLAG 1 baseline re-count (4).
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
only in `notes` are one endpoint. The nonempty check uses the same definition of set,
`num_nonnulls(nullif(x,''), ...) > 0`, so a row of four empty strings is refused rather than
accepted as an endpoint the identity calls "no address" (fable's .sql verdict S1, m53885).
This is the ONLY row identity in the design; the carry rule
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
- **An endpoint row requires host AND port** (fable's design verdict S1, m53938 via m53940).
  The schema's nonempty check is `num_nonnulls(nullif(x,''), ...) > 0`, so `(protocol, null,
  null, null)` and `(null, null, null, compid)` are legal rows and the backfill copies such
  parents verbatim. Clause 1 below matches on `(host, port)`; for an address-less row that is
  `(null, null)`, so every address-less live row would match every address-less submitted row:
  live `X1 = (FIX, null, null, C1)`, `X2 = (SBE, null, null, C2)`, provider submits `[X1]`
  alone, clause 1 sees `(null, null)` present and X2 is silently removed, the one thing the guard
  exists to refuse. Fix, code phase only, no SQL change: `parseEndpointsJson` (section 5 item 3)
  refuses a row missing `host` or missing `port`, naming the column, so clause 1's match is
  defined on every row the app can write. Tightening versus today, stated on purpose: today the
  four are independent inputs and a row with a protocol or a compid and no address is accepted
  (`terms/actions.ts:48-51` passes each as `string | null`); that is NOT ported. A child row
  without host and port can then exist only by backfill of an address-less parent (section 2.2)
  or by coxwell SQL. Census: the step-3 print counts such parents inside "with any scalar" but
  does not print them per row (my read of the .sql at 1f649a9, :176-185); marcus's prod read at
  m53912 is 1 tier row with a host and 0 proposals, so there are none today. A provider whose
  live tier carries a backfilled address-less row is refused by clause 1 on every submission
  (the live `(null, null)` is never in the submitted set) until coxwell fixes the row by SQL; the
  refusal echo names the row's address as blank. Flagged to marcus for a ruling on a per-row
  step-3 print; not built, the .sql is passed.
- **Clause 1, the removal key is `(host, port)`** (ruled m53894, unchanged). Refuse when any live
  tier endpoint's `(endpoint_host, endpoint_port)` is absent from the submission's set of
  `(host, port)`; the message lists the missing addresses, same wording pattern as `:318-319`.
  Why: its one job is to refuse silent removal of an address, and a compid or protocol edit at
  the same address is an edit, not a removal. The removal key decides WHICH live row a submitted
  row is talking about.
- **Clause 2, the narrowing rule on the matched row** (ruled m53894 via m53896). For a live row
  matched by `(host, port)`, any of `protocol` / `compid` going from set to blank is refused, same
  refusal shape as today's per-column guard (`:243-247`, echoed at `:318-319`): the echo names the
  column, never the note (ruling (d) stands). Set -> different value is allowed and re-verifies
  (the four-tuple carry misses, `endpoint_verified = false`). Null -> set is an add, allowed,
  re-verifies. Why: a row that had a verified compid coming back with compid blank IS a silent
  removal, the verified value is gone from the row and nothing told anyone; "a compid edit is an
  edit" covers value -> different value only. A legitimate "drop the compid" goes the same road
  as row removal: coxwell SQL (section 2.2). Net behaviour versus today: the per-column refusal
  of blanks is preserved, and the only thing this section loosens is value -> value edits, which
  is the point of the change. The narrowing rule decides what you may do to the matched row.
  SQL consequence: none; the check constraint and the identity index are unchanged, this is
  code-phase only.
- **Where n > 1 live rows share one address, both clauses are counts per address** (fable's
  code delta-1 strike S1, m54026 via marcus m54028; built at 3d8b1ce). Group live rows by
  `(host, port)`; for each address: (i) fewer submitted rows at that address than live rows is
  a removal, refused as "k of n endpoints removed at host:port"; (ii) otherwise, per column
  `protocol` / `compid`, fewer submitted rows with it set than live rows with it set is a
  narrowing, refused as "Label left blank at host:port". For n = 1 this is byte-identical to
  clauses 1 and 2 as written. Why: the first cut counted a narrowed column as kept if ANY
  submitted row at the address had it set, and with live `(FIX, gw:9443, C1)` verified and
  `(FIX, gw:9443, C2)` verified a submission of `[C2]` alone passed with no refusal: a verified
  session gone and nothing told anyone, the removal this guard exists to refuse. An edit at a
  shared address with the neighbour kept (`C1 -> C3`, `C2` resubmitted) is still an edit.
- **Do not harmonise these two keys.** The carry key answers "is this the same session the admin
  logged on to" and must be the four; the removal key answers "did an address disappear" and
  must be the address; the narrowing rule is not a third key, it is what clause 1's match may
  and may not do. Making the guard the four would refuse every compid edit as a removal; making
  the carry the address would carry a claim across sessions.
- Record: the first cut of this section (0c59101) flagged, unruled, that a row resubmitted at the
  same address with compid blank would pass as an edit and land with compid null. Fable ruled
  that a defect of the `(host, port)` sentence, not of the build (m53894); clause 2 is the fix.

### 2.2 Semantics carried over, now per set

- Confirm = replace-set, implemented as **delete-then-insert inside the confirm's existing FOR
  UPDATE transaction** `[N3]`: snapshot the tier's live endpoint rows (four + verified), delete
  them, insert the proposal's rows at their submitted positions, and compute carry from the
  pre-delete snapshot by the four-tuple. Never upsert-by-position: a position shift would re-key
  verification to the wrong row. An endpoint absent from the round is removed, same as a null is
  written as null today (`:463-467`). No coalesce. That removal is unreachable through the form
  once 2.1 clause 1 holds (the guard refuses the submission at submit time); it is reachable only
  when coxwell edits the live tier rows by SQL between submit and confirm, and then replace
  semantics is the correct outcome, the confirmed round is what the provider submitted and the
  admin saw (fable N2, m53938). Clause 1 has no hole here. The tier row is locked FOR UPDATE
  before the replace-set; the proposal lock alone serialises per proposal, not per tier
  (fable's code delta-2 plan ruling J3, m54043 via marcus m54049; built at f65e492). Lock order
  in every writer that takes both: proposal row, then tier row; submit locks nothing, it is
  check-then-act and the confirm is the write of record. Two concurrent FIRST confirms into one
  tier both INSERT, because provider_tiers has no unique on `(application_id, tier_name)`
  (0060:29-30 are plain indexes); that race is today's, logged as a follow-up, not built here.
- Removal path in this cut is unchanged from today: a provider submitting a set without a live
  address is refused by the guard (2.1 clause 1), and so is a set that blanks a live row's
  `protocol` or `compid` at a matched address (2.1 clause 2); the removal or the blanking is SQL
  by coxwell. A per-row "remove" tick on the terms form is logged as a follow-up (section 6
  item 2), not built here.
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
   (i)..(ii) window that the dual-write did not see). Expected notices:
   `backfill ...: inserted N`, N = listings old code created in the window, which is correct and
   needs no hand resolution (fable's .sql verdict N1, m53885); `drift rows: 0`, and it must be 0.
   A non-zero drift row is printed with both sides verbatim and resolved by hand, not by the
   script `[N4]`.
4. 0092, not written. Order, fixed by fable's design verdict S2 (m53938 via m53940):
   1. Merge and deploy the writer cleanup: the position-0 mirror is removed from submit, confirm
      and register. Every read left the parent columns in the 0091 code phase (step 2), so from
      this deploy on nothing in the live code reads or writes the five parent columns.
   2. Apply 0092. Its gate is **position 0 only**: for every parent, the child row at position 0
      equals the parent four (coalesce both sides) and `endpoint_verified` on the tier side; and
      parent all-null <=> zero child rows. NOT child == parent over all rows: the Pip Dealer
      hand-inserted second row and every N-endpoint listing would fail an all-rows gate by
      design. A drift row at this gate can now only be a write inside the (i)..(ii) window (fable
      names a confirm; by my read of step 2 submit and register write the mirror too, so any of
      the three), printed with both sides verbatim and resolved by hand exactly as step 3 `[N4]`.
      Expected 0.
   3. Drop the five parent columns, in the same 0092 file after its gate.
   0091 is apply-then-merge and 0092 is merge-then-apply for one reason, stated once: the live
   code must never touch a column that is not there. With the drop before the writer cleanup,
   every confirm, submit and register between the apply and the deploy would fail on an
   undefined column, the same break the second paragraph of this section sequences 0091 to
   avoid.

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
- **Grep gate, review-time, two patterns** (fable's design verdict S3, m53938 via m53940: one
  pattern with one allowed set let a SELECT on the table dropped into `terms/page.tsx` pass the
  gate and bypass the viewer assert, which the one-reader rule forbids). After the code phase:
  - (a) Table names. `git grep -n "provider_tier_endpoints\|provider_tier_proposal_endpoints"`
    must hit only `src/lib/provider-tier-endpoints.ts`, its `.test.ts` (fixtures only), and SQL
    text under `db/migrations/` and `docs/specs/`. No page, action or component names a table.
  - (b) Column name. `git grep -n "endpoint_host"` keeps the wider allowed set: `src/app/admin/`,
    `src/app/feed/dashboard/terms/`, `src/app/admin/register-provider/`,
    `src/lib/provider-tier-endpoints.ts`, `db/migrations/`, `docs/specs/`. camelCase field names
    and the `page.tsx:72` comment are not reads.
  Baseline at e4edea2 (`git grep -c endpoint_host e4edea2 -- <path>`, re-counted at code
  delta 4 for fable's FLAG 1, m54026 via marcus m54028; the first cut of this line said 15 for
  provider-tier-proposals.ts and was wrong): 3 hits in `db/migrations`, 1 in
  `src/app/admin/providers/page.tsx:72` (a comment), 12 in
  `src/lib/provider-tier-proposals.ts`, 5 in `src/lib/provider-tiers.ts`; the table names have
  zero hits at e4edea2 because the tables do not exist yet. The two `src/lib` files must reach
  zero hits on both patterns: every SQL that names these tables or columns moves into the
  module. Any new hit outside either allowed set is a review failure, not a judgement call.
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

1. `endpointsThatWouldClear(live, submitted)` in `provider-tier-endpoints.ts`, matched on
   `(host, port)`, replacing the per-column `connectionFieldsThatWouldClear`. It returns the
   missing addresses (2.1 clause 1) and, per matched row, the columns narrowed set -> blank
   (2.1 clause 2); either non-empty is a refusal.
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
   - Narrowing, ruled m53894 via m53896, each case runs the guard of item 1 and the carry
     together on one input, which is why they sit here:
     - live `[A verified, compid set]`, resubmit the same `(host, port)` with compid blank ->
       refused, echo names `compid`, never the note (fail-first: written before the narrowing
       output exists, so the first run fails on the guard returning `[]`).
     - same with a different compid -> accepted, carry misses, `endpoint_verified = false`.
     - same with protocol blank on a row that had one -> refused, echo names `protocol`.
3. `parseEndpointsJson(raw)` for the terms action and register-provider action: drops all-blank
   rows, assigns positions 0..n-1 in order, rejects 9 rows, rejects a row with only `notes` set,
   rejects a row with host but no port and a row with port but no host, the error naming the
   missing column (2.1, an endpoint row requires host and port; fable S1 m53938). Item 1 gains
   no case for this: its input can no longer contain an address-less row.
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
test files above passing on a box that can run them (nobody has run them yet; `[N5]` stands until
a run output is on the bus), both grep patterns of section 4 at zero hits outside their allowed
sets, fable's pass on the 0091 .sql, and coxwell's apply notices on the bus.

## 6. Rulings (fable via marcus m53845) and follow-ups

1. Admin confirms blind today (row 6): a defect, not new scope. The review card lists every
   endpoint row of the round with its verified state and which rows will carry.
2. Removal: replace-set, no partial removal in this cut. Follow-up logged: a per-row "remove"
   tick on the terms form so a routine flavour drop does not need coxwell SQL. Not built here.
3. Register-provider: position 0 only, checkbox = that row's `endpoint_verified`, no compid.
4. `notes`: provider-authored on the proposal form, admin-only render, never buyer, never in the
   refusal echo (section 2.2).
5. Numbering 0091/0092 and docs/specs location: per m53796, superseded fable's (e).
6. Blank at a matched address (fable m53894 via marcus m53896): REFUSE THE BLANK. Section 2.1
   clauses 1 and 2; three tests in section 5 item 2; no SQL change, code phase only.
7. Address-less rows (fable m53938 via marcus m53940, S1): an endpoint row requires host and
   port at the parser; section 2.1 and section 5 item 3; no SQL change, code phase only. The
   per-row step-3 print of address-less parents was ruled NO (fable m53977 via marcus m53979,
   FLAG 1): no SQL change, the .sql stays passed at 1f649a9. Reason: the population is measured
   at 0 (m53912), step 3's re-run reports any window row as `backfill ...: inserted N` for
   coxwell to read, the parser then makes such a row impossible, and one that still slips
   fails loud at clause 1. Closed.

Open: none from the design. The .sql and rollback passed at 65a32dc (m53910) and the N1 header
clause is at 1f649a9; the code phase starts only after fable passes the hunks of this file.

## 7. Files the code phase would touch (declaration, not yet opened)

`src/lib/provider-tier-proposals.ts`, `src/lib/provider-tiers.ts`, `src/app/admin/providers/page.tsx`,
`src/app/admin/providers/[proposalId]/page.tsx`, `src/app/feed/dashboard/terms/actions.ts`,
`src/components/feed/tier-proposal-form.tsx`, `src/app/admin/register-provider/actions.ts`,
`src/components/admin/register-provider-form.tsx`, new `src/lib/provider-tier-endpoints.ts` and
its `.test.ts`, `db/migrations/0091_provider_tier_endpoints.sql` + rollback moved from docs/specs.
None of these is `server-registration.ts` or ip-history.
