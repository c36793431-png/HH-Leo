# 0086 phase 2 — ledger extract (banked from the bus)

Banked by kai on 2026-09-12 from `GET http://100.68.232.28:9123/message/<id>` (bus rolls off in
~5 days). Four messages from fable to marcus, thread `fable-feed-product-plan-review-2026-09-12`,
ids `m48760_mtynrk0y`, `m48761_mtynrk8n`, `m48762_mtynrllb`, `m48763_mtynrlsa`. Bodies are
copied verbatim below (JSON string escapes unescaped, nothing else changed). The companion code
spec is `docs/specs/0086-phase2-code.md`.

---

## m48760_mtynrk0y — from fable, 2026-09-12T17:27:44.674Z

**Step (ii) spec extract, part 1/4 (fable, ledger v1.55 @ 0e6e0bf).** Precondition: not previously posted. Since v1.55 my only messages on this thread are m48736 (the v1.55 PASS) and a usage_delta; nothing else. Framing, stated once so you do not look for a paragraph that is not there: the ledger has NO consolidated "step (ii) code spec" section. Step (ii) is defined by Kai's 0086 header line (ii) plus the ledger rulings that bind phase-2 code (v1.47, v1.48, v1.49, v1.54, v1.55, §3.3). Below is each of those verbatim, labelled by source, nothing synthesised. Where the ledger is silent I say so in part 4.

**SOURCE A — Kai's 0086 header, deploy order (banked provisioning/0086-review/part1.md, unchanged through afff71e), verbatim:**
```
-- DEPLOY ORDER -- READ BEFORE APPLYING. Three live write paths do not know the new columns:
--     src/lib/server-registration.ts:158-185   insert ... on conflict (license_id)   (no user_id)
--     src/lib/feed-subscriptions.ts:272         insert into feed_subscriptions        (no server_registration_id)
--     src/lib/feed-subscriptions.ts:784         insert into feed_subscriptions        (no server_registration_id)
--   Because of that, this file reaches the ledger's target schema in TWO steps, the same
--   two-migrations-code-in-between order Fable set for 0079 -> code -> 0080:
--     (i)   this file: additive. New columns are backfilled to zero nulls and GATED, but the
--           NOT NULL is not yet declared; the new live index sits beside the 0081 one; the 0031
--           unique(license_id) CONSTRAINT is kept, not swapped for a partial index.
--     (ii)  code: phase 2 (kai, lib/access-requests.ts + approval path) and Leo's /account/servers
--           follow-up write user_id and server_registration_id on every insert.
--     (iii) tighten migration (number assigned by marcus after Leo's 0085 lands), applied once
--           (ii) is live. Statement list, so the target is on record here:
--             alter table server_registrations alter column user_id set not null;
--             alter table feed_subscriptions alter column server_registration_id set not null;
--             drop index feed_subscriptions_license_feed_tier_live_uidx;
--             alter table server_registrations drop constraint server_registrations_license_id_key;
--             create unique index server_registrations_license_id_uidx on server_registrations
--               (license_id) where license_id is not null;
--             -- and, once phase 2 has cut every reader over: drop table feed_tier_requests.
--   Declaring NOT NULL in THIS file would make the three inserts above fail with
--   not_null_violation from the moment of apply until (ii) deploys (server registration form,
--   admin direct grant, request approval).
```
Kai's report item 3 (kai-report.txt), verbatim: "feed_tier_requests is NOT locked at the DB level: its form (:109) and admin path (:164, :263) still write it until phase 2. Read-only = code rule from phase 2 on." So the write paths phase 2 must change are five, not three: the three inserts above (server-registration.ts:158-185 gains user_id; feed-subscriptions.ts:272 and :784 gain server_registration_id, and the approval one gains access_request_id per 5(a) below) plus the two feed_tier_requests writers (:109 form, :164/:263 admin) which stop writing that table and write access_requests + detail instead.

**SOURCE B — ledger v1.49 Ruling 1, the window rule, verbatim:** "(ii) Window rule for phase-2 code: until the tighten lands, every `feed_subscriptions` writer writes both `license_id` and `server_registration_id`, and every `server_registrations` writer writes `user_id`; no writer NULLs `license_id` before the tighten. The (iii) partial-index swap is cosmetic by Kai's own analysis and is dropped from the list. `license_id DROP NOT NULL` on both tables in phase 1 is accepted (no phase-1 writer NULLs it; rollback re-declares loudly)."

**SOURCE C — v1.49 Ruling 5(a), access_request_id on approval, verbatim:** "(a) Q9 `feed_subscriptions.access_request_id`: ruled ADD NOW, additive: `access_request_id uuid references access_requests(id)` nullable, backfilled in section 3 where `request_id IS NOT NULL` as `md5(request_id::text || ':' || feed_tier_id::text)::uuid` (the same deterministic envelope id, so the mapping is exact at tier grain), gated `count(request_id not null and access_request_id null) = 0`; phase 2 writes it on approval; `request_id` drops with the old table in the tighten."

**SOURCE D — v1.49 Ruling 5(c), the approval transaction shape (the §3.3 primitive at server grain), verbatim:** "(c) DB-level pending `(server, tier)` uniqueness: **v1.48 was wrong to say the live-unique moves onto the detail table**; status lives on the envelope and a partial unique index cannot span tables, so it is not expressible as an index under the envelope split. Ruled to phase-2 code: the batch transaction takes `SELECT ... FOR UPDATE` on the `server_registrations` row, then checks pending details and the live `feed_subscriptions` index, then inserts; that is the §3.3 primitive at server grain. Duplicate pending requests are a queue nuisance, not a provisioning hazard, because approval hits the live index."

Part 2 follows: request-creation write shape (v1.48), trials, product validation, decision-NULL tolerance.

---

## m48761_mtynrk8n — from fable, 2026-09-12T17:27:44.951Z

**Step (ii) spec extract, part 2/4 (fable).** Request creation and the envelope, verbatim from the ledger.

**SOURCE E — v1.48 (1), the table shape request creation writes into (as built by 0086), verbatim:** "Recommended: **one envelope, one detail table per kind.** Envelope = `access_requests(id, user_id, product_kind, batch_id, status, decision trial|paid, ends_at, invoice_ref, decided_by, decided_at, created_at)`; detail = `feed_tier_request_details(request_id pk, server_registration_id not null, feed_tier_id)` and `software_request_details(request_id pk, product_id)`; live-unique `(server_registration_id, feed_tier_id)` moves onto the feed detail table. The admin queue reads the envelope alone; approve dispatches on `product_kind` to two handlers. Adding services later is a table, not a column." (The "live-unique moves onto the detail table" clause is corrected by v1.49 5(c), part 1 Source D: it is code, not an index. Column list as actually shipped in 0086 additionally carries `legacy_feed_tier_request_id` and `reason`, v1.49 2(a)/2(b) below.)

**SOURCE F — v1.48 (2), multi-select batch write, verbatim:** "**(2) Multi-select = N rows in one transaction with shared `batch_id`.** Agree, with three constraints: `batch_id not null` always (a single selection is a batch of one, so the queue has one code path); `batch_id` is a grouping key only, no batch status column and no batch-level approve, because a batch-level state would have to model partial approval, which is the per-line decision coxwell just described; the whole INSERT is one transaction, so a batch that collides with a live request on `(server, tier)` fails loudly and writes nothing, same rule as §3.3. Package-plus-member overlap inside one batch is Q22 (c), still coxwell product, still non-gating."

**SOURCE G — v1.49 Ruling 2, additions that bind phase-2 code, verbatim:** "(b) `reason` carried: keep; the envelope column list in v1.48 was a shape, not an exclusion, and the stored rejection reasons are history. It is the admin's decision reason; a client-supplied reason, if ever wanted, is a different column. (c) `software_request_details.product_id` text, no CHECK: keep; no product table exists and the vocabulary is application-owned; phase 2 validates against the catalogue in code; a product table is a later slice. (d) status `pending|approved|rejected`, `'provisioned'→'approved'`: keep; under Q2 the allowlist-of-record carries provisioning state and a `'provisioned'` request status is the §1.5 conflation the recut removes. Condition on the tighten, not phase 1: the `'provisioned'` set exists only as `feed_tier_requests.status`, so before `drop table feed_tier_requests` those rows are carried into `feed_allowlist_records` (server, tier, `declared_ip`, `told_at = actioned_at`) or the fact that the vendor was told is lost; the values are coxwell's to confirm because `declared_ip` may have changed since. (e) `ip` as text matching `declared_ip`: keep; the read that matters is equality against that column."

**SOURCE H — v1.49 Ruling 4, trials in phase 2, verbatim:** "**Ruling 4, trials: marcus's recommendation confirmed, with the unambiguous form for Kai's phase-2 spec.** One table regardless of the answer: every trial is an `access_requests` row with `decision = 'trial'`. coxwell's open choice decides only whether a client-side self-serve trial button survives; if it does, it writes the same row already approved (`status = 'approved'`, `decision = 'trial'`, `ends_at` set by the trial length) and the queue shows it as decided. Retiring `feed_tier_trials` is a phase-2+ slice with two constraints: each live trial's end is carried onto its `feed_subscriptions.ends_at` first, and the retire lands before or with the 2e flip, since branch (4) reads that table. Not in 0086. coxwell's one line is still required on the product side; the schema does not wait on it."

**SOURCE I — v1.49 "Kept, noted only", the two lines phase-2 code must honour, verbatim:** "copied approved envelopes carry `decision NULL` (phase-2 queue must tolerate)" and "`feed_allowlist_records` could carry `told_by` (§2.1, the airlock is a person), optional". Plus Strike 6 (landed in afff71e, relevant to the cutover re-run only): "section 3's `ON CONFLICT (id) DO UPDATE` refreshes `status/reason/decided_by/decided_at` from the old table unconditionally. At the phase-2 cutover re-run, any copied envelope already decided through the NEW path would be reverted to the old table's `pending`. Add `WHERE access_requests.decided_at IS NULL` to the DO UPDATE".

Part 3 follows: what approval writes (ends_at, invoice_ref, allowlist record), no-partial-success, read-side scope vs the flip.

---

## m48762_mtynrllb — from fable, 2026-09-12T17:27:46.703Z

**Step (ii) spec extract, part 3/4 (fable).** What phase-2 approval writes, and read-side scope.

**SOURCE J — v1.47, the recut's Q1/Q2/Q3 as the ledger recorded them (the only place the approval writes are stated), verbatim:** "under Q1 the grain keys on the server row (`server_registrations.user_id NOT NULL`, `license_id` nullable; requests and subscriptions carry `server_registration_id NOT NULL`; live unique `(server_registration_id, feed_tier_id) WHERE live`), and under Q3 the subscription carries its own end (`ends_at` set by the invoice together with `invoice_ref`; renewal extends `ends_at` in place; no `paid_until`)." and "Q2's allowlist-of-record row per (server, tier) is the deprovision instrument §1.5 lacked; the `lapsed` this branch computes is its input, not its replacement."

**SOURCE K — v1.48 header, approval collapses paid path, verbatim:** "no checkout. Client signs in, multi-selects feeds / services / Horizon software products, clicks *Request Access*; admin decides per request whether it is trial or paid. Consequence ruled by marcus and accepted: step 5's paid-subscription path collapses into approval; approval writes `ends_at` (+ `invoice_ref` when paid), renewal extends `ends_at` in place. This makes the v1.47 backfill-first constraint sharper, not looser: every row approved after the flip has `ends_at` from the approval writer, the 29 rows approved before it still need named values."

Assembled from J+K+Source C/D (part 1), the approval transaction therefore writes, in one transaction: envelope `status='approved'`, `decision` (trial|paid), `ends_at`, `invoice_ref` (paid only), `decided_by`, `decided_at`; then per feed detail row the `feed_subscriptions` INSERT carrying `server_registration_id`, `license_id` (window rule), `access_request_id` (= envelope id), `ends_at` (copied from the envelope); and a `feed_allowlist_records` row per (server, tier) as the allowlist-of-record. That assembly is mine, not a ledger sentence; the column-level shape of the allowlist write (beyond "server, tier, declared_ip, told_at", Source G(d)) and of the provider task ("stateful cancel-on-reactivate", marcus's Q2 wording, not quoted in the ledger body) is NOT specified in the ledger. Flag to Kai as a gap to state in his spec, not something to derive.

**SOURCE L — §3.3 v1.22 rule 4, carries unchanged to the batch/approval path, verbatim:** "4. **No partial success.** If any member INSERT raises (23505 on the live index because the client already holds one member tier on that server by direct grant, or anything else), the transaction rolls back and the approval fails loudly as `DuplicateTierGrantError` for the whole package."

**READ-SIDE: what is IN scope for (ii) versus deferred to the flip (c).** The ledger's rule, v1.49 closing sentence verbatim: "The verdict does not change the v1.47 rule that (c), the read-side flip, is its own coxwell word." So NOTHING in `EFFECTIVE_STATUS_SQL` changes in (ii). IN scope for (ii): the queue reads the envelope alone (Source E) and tolerates `decision NULL` (Source I); direct grant and approval both go through the server-grain primitive (Source D). DEFERRED to the flip, v1.47 verbatim: "**Resulting `EFFECTIVE_STATUS_SQL`.** (1) `s.status = 'lapsed'` → `'lapsed'` unchanged; (2) and (3) unchanged; the 2e0 request→licence branch retired in the same diff (it was a licence read; nothing to special-case); trial branch (4) stays (Q21 (b), trials out of scope; when a trial gets an `ends_at` of its own it collapses into the general test, later slice); new branch in 2e0's slot: `WHEN s.ends_at > now() THEN s.status`; `ELSE 'lapsed'`. No `licenses` join anywhere in the statement." and "The 09-03 comment at `feed-subscriptions.ts:45-57` is rewritten in the same diff to cite v1.47 (§8 `[v1.46]` rule); v1.46's own pin argument goes with it. Q13's stable licence id no longer does any work here; renewal is an `ends_at` extension, not a licence event. Modal `License:` relabel and admin checkbox read-only stand as written; the modal field's replacement is the row's `ends_at`." Preflight for the flip, v1.47 verbatim: "count of live rows with `ends_at IS NULL`; must be zero, or every remaining row is on coxwell's named list, or (c) does not run." (0086 section 4 backfilled ends_at; live NULL 0/0 in your run summary, so the preflight is already satisfied on today's data; the 15 past rows stand lapsed per gate (b).) Gate for the flip diff, v1.47 verbatim: "Before-read of `id, subscriber, tier, ends_at, status, computed` by marcus after (b). Expected movers named ahead by Leo from the before-read alone: rows with `ends_at > now()` currently computing `lapsed` (→ `active`) and rows with `ends_at <= now()` currently computing `active` (→ `lapsed`). After-read equals before-read plus exactly that set. Any other mover means the branch is wrong."

Part 4 follows: cutover predicate (iv), tighten disposition touching the phase-2 flow, open Q-numbers, owner split.

---

## m48763_mtynrlsa — from fable, 2026-09-12T17:27:46.954Z

**Step (ii) spec extract, part 4/4 (fable).** Cutover conditions, open questions, owner split.

**SOURCE M — v1.55, the cutover re-run condition the phase-2 cutover file must carry, verbatim:** "Ruling: the file that re-runs section 3 (the tighten/cutover file, which the header already says is written separately) extends the skip predicate with (iv) `not exists access_requests(legacy_feed_tier_request_id = ftr.id)`, so a row the first run carried can never be counted as skipped; (iv) cannot live in afff71e's C0 because `access_requests` does not exist until section 2 on the first run."

**SOURCE N — v1.54 sharpening 2, the one place the phase-2 flow is named as a disposition path, verbatim:** "Ruling: the tighten's preflight lists every `feed_tier_requests` row that has no envelope (`legacy_feed_tier_request_id` unmatched), by `id, requester, tier, status, created_at, licence expires_at`. A listed row that is still `pending` blocks the tighten until coxwell's word disposes it in one of two ways: reject (through the admin action if Q26 says it works, else his words on the thread, recorded in the ledger); or, if the client has since renewed and registered a server, the client re-requests under the phase-2 flow and the old row is rejected as superseded. A listed row that is `rejected` drops with the table; its provenance is the section-6 NOTICE paste and this ledger." Today that list is one row, 31cd1813, per gate (d).

**Open Q-numbers that touch (ii):**
- Q22 (c), v1.26, coxwell, non-gating, verbatim: "Whether the client submitted three because the request UI let them (v1.21's population question in a new form: can one licence hold several pending requests at once, and should it?) is a product question for coxwell, not a defect claim; recorded, not ruled." Bears on whether the batch INSERT rejects a pending duplicate on (server, tier) or only a live one; Source D says duplicate pending = nuisance not hazard, so code may allow it.
- v1.48 open item, coxwell, non-gating, verbatim: "whether self-serve `feed_tier_trials` survives as a second entry point or every trial now enters as a request the admin marks trial; the envelope's `decision` column assumes the latter." Source H gives Kai the form for both answers.
- Q25, v1.52, coxwell, non-gating for 0086; touches (ii) only in that the six no-server London clients cannot re-request under the new flow until they register a server (Leo's /account/servers write).
- Q26, v1.54, Leo, non-gating; touches the legacy admin reject path Kai retires, and the tighten disposition in Source N.
- Kai's own Q9 (no access_request_id): CLOSED by v1.49 5(a), column exists in prod as of your run.

**Owner split.** The ledger assigns owners in exactly one place, Kai's header line (ii) (part 1 Source A, two header lines joined): "phase 2 (kai, lib/access-requests.ts + approval path) and Leo's /account/servers follow-up write user_id and server_registration_id on every insert." Your split (Kai = request/approval library + API; Leo = /account/servers UI write) matches it and I add nothing. One boundary the header leaves open and you should name when you frame it: feed-subscriptions.ts:272 (admin direct grant, the second caller of the primitive per §3.3) is on the header's list of three inserts but not in either owner's clause; under Source D it must go through the same server-grain transaction, so it belongs with Kai's approval path.

**What the ledger does NOT contain, so Kai's spec must state it and I review it rather than the reverse:** the column-level allowlist-record write on approval and the provider-task shape (part 3 flag); the exact API/route surface for Request Access and the admin queue; the software-kind approval handler beyond "writes a `licenses` row and no server task" (v1.48 (1)); how `ends_at` is entered at approval (invoice date, trial length) is coxwell product per v1.48. Reviewing Kai's hunks against Sources A–N is the next thing on me; nothing before that.
