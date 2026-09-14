N1 preflight (fable): `git grep -n request_id -- src` at origin/main `9e84f16` (contains the phase-2 merge `3ded80d`), run by kai in the working tree of `kai/tighten-0087-2026-09-12`, 18 lines, verbatim:

```
src/lib/access-requests.ts:24: * legacy_feed_tier_request_id, or touches the read side (EFFECTIVE_STATUS_SQL, section 8). */
src/lib/access-requests.ts:200:       join access_requests a on a.id = d.request_id
src/lib/access-requests.ts:218:      `insert into feed_tier_request_details (request_id, server_registration_id, feed_tier_id) values ($1, $2, $3)`,
src/lib/access-requests.ts:308:        `select server_registration_id, feed_tier_id from feed_tier_request_details where request_id = $1`,
src/lib/access-requests.ts:321:        // access_request_id = the envelope (Source C), ends_at from the decision (Source K),
src/lib/access-requests.ts:322:        // status 'active' for both decisions (fable P4; trial-ness is decision + access_request_id).
src/lib/access-requests.ts:328:              status, access_request_id, ends_at)
src/lib/access-requests.ts:492:  legacy_feed_tier_request_id: string | null;
src/lib/access-requests.ts:513:         a.invoice_ref, a.reason, a.decided_by, a.decided_at, a.legacy_feed_tier_request_id,
src/lib/access-requests.ts:521:  left join feed_tier_request_details d on d.request_id = a.id
src/lib/access-requests.ts:525:  left join software_request_details s on s.request_id = a.id
src/lib/access-requests.ts:541:    legacyFeedTierRequestId: row.legacy_feed_tier_request_id,
src/lib/access-requests.ts:594: * feed_tier_requests.id; 0086 section 3 copied it onto legacy_feed_tier_request_id, as N
src/lib/access-requests.ts:600:    `${LIST_SQL} where a.id = $1 or a.legacy_feed_tier_request_id = $1 order by a.created_at desc, a.batch_id, ft.tier_key`,
src/lib/feed-subscriptions.ts:331:          provider_tier_id, status, access_request_id, ends_at)
src/lib/feed-subscriptions.ts:1297: * (request_id, feed_tier_id)` against the legacy feed_tier_requests id) moved to
src/lib/feed-subscriptions.ts:1301: * fable P3), and feed_subscriptions.request_id is no longer written -- it drops with the old
src/lib/feed-subscriptions.ts:1349: * written for a direct grant (access_request_id NULL; Source H mandates one for trials only). */
```

Three-way reading of the 18 (same reading as 0086-phase2-code.md section 10, now repo-wide under `src`):
- 7 comments: access-requests :24, :321, :322, :594; feed-subscriptions :1297, :1301, :1349.
- 5 detail-table `request_id` (`feed_tier_request_details.request_id` / `software_request_details.request_id`, both FKs to `access_requests.id`): :200, :218, :308, :521, :525.
- 6 substring hits on `access_request_id` (:328; feed-subscriptions :331) or `legacy_feed_tier_request_id` (:492, :513, :541, :600).

No line selects, inserts, updates or joins `feed_subscriptions.request_id`. The only two files that hit are the two `src/lib` files section 10 already covered; the repo-wide run adds zero files and zero lines (section 10's run at the C2 docs commit was also 18 lines; line numbers moved in feed-subscriptions.ts because main gained Leo's revenue and provider-panel commits, the lines themselves are the same). Result: NO READER FOUND, the spec does not stop here.

Companion grep, `git grep -n feed_tier_requests -- src` at `9e84f16`, 13 lines, all inside comments (no SQL, no identifier): access-requests :23, :96, :455, :510, :594; black-trials :310; feed-providers :7; feed-subscriptions :436, :1257, :1297; feed-tier-catalogue :49; feed-tier-requests :29, :136. Zero code reads the table; `DROP TABLE` cannot land on a reader.

---

# 0087 tighten -- spec (step iii of the 0086 deploy order)

Governs `db/migrations/0088_tighten.sql` and `0088_rollback.sql`; the 0087 in this filename is historical (marcus m49474_mtzsh4hu, no rename; fable agrees, m49479_mtzsplf7).

Author: kai. Branch: `kai/tighten-0087-2026-09-12`, off origin/main `9e84f16` (3ded80d = phase-2
merge, 22:58Z; 9e84f16 = Leo's revenue-history date fix on top). Reviewer: fable. Owner: marcus.
Product owner: coxwell. Thread: kai-tighten-0087-2026-09-12 (marcus m49169).

Status: SPEC v4 = v3 (20d1c17) + fable's hunk review of v3, PASS-WITH-STRIKES T1-T6
(m49478_mtzsp97b + m49479_mtzsplf7, 2026-09-13 12:33Z, read by me on the bus), taken by fable
against fable's OWN originals, not against marcus's relay. v3 was built on 6d20110 (v1) per marcus
m49385_mtzpd4fx (2026-09-13 11:00Z, the complete job) and folds in fable's PASS-WITH-STRIKES on
6d20110 (m49198_mtz0hi3c S1-S4, m49199_mtz0hjpn Q1-Q7, m49201_mtz0hlbm N1-N5, all 2026-09-12
23:23Z, read by me on the bus), fable's m49231_mtz0pepn amendments (23:30Z; reached v3 through
marcus m49385's relay, CONFIRMED in fable's m49478 as landed faithfully, so cited directly from v4
on), fable's S3 ruling m49281_mtz1czu5 (23:48:19Z; v3 mis-cited it as m49275, which is a usage_delta
telemetry row of mine, fable m49478) with m49294_mtz1gg15 (read (2) predicate) and
m49310_mtz1l22g (the load-bearing note), and marcus m49215_mtz0lxlf (23:27Z, "fable governs",
withdrawing the R1 and R3 rulings; section 12 is history only). The 7527d3c (R1 WARN) and 6f2ada9 (R3
no-CHECK + no-server index) edits are reverted: step 5 / step 6 / section 2 (b) / section 4 /
section 9 are in the CHECK form. Migration file = `db/migrations/0088_tighten.sql` (R2, the one
live ruling in section 12); this document keeps its 0087 name. v4 changes (fable T1-T6 + two
cite fixes + notes): T1 S3 apply gates in sections 9 and 11; T2 the ruled S3 source comment and
the option-(a) accepted case in section 4; T3 section 7 license_id NULLABLE correction; T4
section 8 S1(ii) user-delete sentence; T5 step 0 no longer requires '0087' (parked); T6 2b(c)
rows are carries with `told_at = actioned_at`, rollback guard counts them. No migration file and
no code until v4 hunks are posted; then the two 0088 files, whole, once.
Every "Source X" is the verbatim ledger text banked in `docs/specs/0086-phase2-ledger-extract.md`;
every "fable S/Q/N" is fable's text in the three messages above, quoted, not relayed. "0086 header"
means the DEPLOY ORDER block of `db/migrations/0086_marketplace_recut.sql` as merged (lines 59-104
at 9e84f16), which is the ledger's own statement list for this file. Anything that is not a Source
citation or a header quote is a PROPOSAL and is marked so. Line anchors are at `9e84f16`.

Not in my reads, stated up front so nobody takes a relay for a finding (rule 8):
- The ledger's section 9 paragraph and fable's B-1 sentence: now quoted verbatim from fable's Q7
  (sections 6 and 7); still fable's text, not my read of the ledger file.
- Every prod count. Section 11 lists the SELECTs; marcus runs them. Marcus's 23:22Z reads
  (m49188_mtz0c0pq) are cited where used and marked as marcus's.
- The phase-2 deploy instant (S3): `2026-09-12T22:58:19Z`, ruled by fable m49281_mtz1czu5
  (23:48:19Z, ledger v1.65): option (a), no pad, "loud-and-stuck beats silent-and-wrong". The
  instant itself is Leo's read of the Vercel deployment (m49262), not mine and not of any deploy
  log. It is the one literal in both SQL files (step 1 comment, section 4 guard) and in section 9
  item 6, always under the ruled source comment (T2, section 3 header). No placeholder remains in
  this document. Its two APPLY GATES (m49281 + m49294, fable T1) are in section 11 and section 9.
- Postgres major version (S1): the composite FK's `on delete set null (license_id)` column-list
  form needs PG >= 15. Prod is 17.11 (marcus m49219 item 1, via fable m49479; not my read); marcus
  pastes `show server_version` (section 11) as a re-confirm.
- Marcus's 23:37Z NULL-safe re-read (m49385 (B), Neon MCP, read-only): both S1 counts in
  section 11 are 0 on today's data. Cited there as expected values, not as my finding.

---

## 1. Files to touch (declared before touching)

| # | File | State at 9e84f16 | Change |
|---|------|------------------|--------|
| 1 | `docs/specs/0087-tighten.md` | NEW | This document. |
| 2 | `db/migrations/0088_tighten.sql` | NEW (0087 is Leo's, section 12 R2) | Section 3. Written after fable reads the v3 hunks; goes to fable whole, once, with file 3. |
| 3 | `db/migrations/0088_rollback.sql` | NEW | Section 4. Written in the same commit as file 2. |
| 4 | `src/lib/feed-subscriptions.ts` | :388-411 `assertNoLiveGrant` (second query = the 0081 window check, REMOVAL POINT comment :392-393); :37-45 `CreateSubscriptionInput` comment; :1295-1302 comment | Code cleanup AFTER the migration is applied (section 8): delete the second query, `licenseId` leaves the args, rewrite the three comments citing the Q6 split (v1.63). Separate commit. |
| 5 | `src/lib/access-requests.ts` | :323 comment ("or on the 0081 licence index") | Comment only, same cleanup commit. |
| 6 | `db/migrations/0089_drop_server_or_lapsed_exception.sql` | NEW (section 12 R4, order R5, list source R9) | Follow-up stub: read the carried ids out of the live CHECK, re-key them, gate live NULL-server carried rows = 0, refusal gate + lapse the expired ones, gate no-server non-lapsed = 0, CHECK without the exception, drop 0081. Number is the next free one; marcus confirms it. |
| 7 | `db/migrations/0089_rollback.sql` | NEW (section 12 R4) | Companion to file 6, same commit. |

NOT touched by kai (so marcus can hold them):
- `src/lib/server-registration.ts` :160-215 (`saveServerRegistration`, writes `user_id` at :180 and
  :186 -- Leo's follow-up is on main, my read), and its comments at :107, :171-175, :471, :507 that
  say "once the tighten lands". Leo's file. The tighten needs nothing from it; the comments become
  stale wording, Leo's to refresh.
- `src/app/admin/connections/page.tsx` :121-123 comment "cannot happen before the 0086 tighten".
  Leo's. Behaviour already handles the null case.
- `src/lib/feed-subscriptions.ts` :140-157 `EFFECTIVE_STATUS_SQL`: unchanged. It still joins
  `licenses` on `s.license_id` (:144-146, my read), i.e. the read-side flip (c) has NOT run.
  Consequence in section 7.
- `src/app/feed/dashboard/*`, `src/lib/feed-providers.ts`: NOT opened in this job. Fable Q5 ruled
  section 6 PERMISSION ONLY; the Subscribers-page shape is banked in the ledger for a later Leo
  slice after B-1.
- `src/app/feed/dashboard/page.tsx` :16 `TYPE_ICON` still has a dead `provisioned` key; harmless,
  Leo's, not touched.

---

## 2. What the ledger says the tighten is (its words, my order)

**0086 header (iii), lines 72-79 as merged, verbatim:**
```
--     (iii) tighten migration (number assigned by marcus after Leo's 0085 lands), applied once
--           (ii) is live. Target statements, so the end state is on record here:
--             alter table server_registrations alter column user_id set not null;
--             alter table feed_subscriptions add constraint feed_subscriptions_server_or_lapsed_chk
--               check (status = 'lapsed' or server_registration_id is not null);
--             drop index feed_subscriptions_license_feed_tier_live_uidx;
--             -- and, once phase 2 has cut every reader over: drop table feed_tier_requests
--             -- (feed_subscriptions.request_id drops with it, not here).
```
**Header lines 80-92 (what the preflight must list and how NULL server rows are disposed), verbatim:**
```
--           feed_subscriptions.server_registration_id is deliberately NOT `set not null` (ledger
--           v1.52): SET NOT NULL is column-wide and would fail on a lapsed row with NULL server
--           forever, so three dead licences would hold the tighten hostage. The tighten's
--           preflight lists every still-NULL server_registration_id row; live ones
--           (ends_at > now()) block the tighten until resolved; dead ones (ends_at <= now()) are
--           stored status='lapsed' inside the tighten transaction, which makes stored status
--           agree with computed, and the CHECK then holds. server_registrations.user_id keeps
--           `set not null` as above; both request-detail tables already declare NOT NULL on
--           their key columns in section 2 and keep it.
--           Legacy request rows skipped under ledger v1.54 (no envelope): the tighten's
--           preflight lists every legacy request row with no envelope (id, requester, tier,
--           status, created_at, licence expires_at). A pending one blocks the tighten until
--           coxwell's word disposes it; a rejected one drops with the table.
```
**Header lines 93-97, verbatim:** "The tighten file will: re-run the section 1 and section 4
backfills and their gates (rows the old code wrote between apply and (ii) have NULL user_id /
server_registration_id), re-run preflight D over the completed mapping, and only then SET NOT NULL
on user_id, add the CHECK, and drop the 0081 index."

**Header lines 109-110, verbatim:** "Section 3 is re-runnable for exactly this reason -- run it once
more inside the phase 2 cutover, then the tighten migration drops it."

**Header lines 148-150, verbatim:** "server_registrations.license_id keeps `on delete cascade` (0031)
in THIS file. The switch to `on delete set null` (key-on-the-server: a deleted licence must not
delete the server) is in the tighten migration, ruled ledger v1.49 5(b)."

**Source C (v1.49 5(a)):** "`request_id` drops with the old table in the tighten."

**Source G(d) (v1.49 Ruling 2):** "Condition on the tighten, not phase 1: the `'provisioned'` set
exists only as `feed_tier_requests.status`, so before `drop table feed_tier_requests` those rows are
carried into `feed_allowlist_records` (server, tier, `declared_ip`, `told_at = actioned_at`) or the
fact that the vendor was told is lost; the values are coxwell's to confirm because `declared_ip`
may have changed since."

**Source M (v1.55):** "the file that re-runs section 3 (the tighten/cutover file ...) extends the skip
predicate with (iv) `not exists access_requests(legacy_feed_tier_request_id = ftr.id)`, so a row the
first run carried can never be counted as skipped".

**Source N (v1.54 sharpening 2):** the no-envelope listing "by `id, requester, tier, status,
created_at, licence expires_at`. A listed row that is still `pending` blocks the tighten until
coxwell's word disposes it ... A listed row that is `rejected` drops with the table". "Today that
list is one row, 31cd1813, per gate (d)."

**Source B (v1.49 Ruling 1):** the window rule ("no writer NULLs `license_id` before the tighten")
and "The (iii) partial-index swap is cosmetic by Kai's own analysis and is dropped from the list."

**Scope note for marcus and fable (not a design-around).** m49169 item (1) names three statements
(DROP COLUMN request_id, drop the (request_id, feed_tier_id) index, DROP TABLE last). The ledger's
own list for step (iii), quoted above, also contains: the section 1/3/4 re-runs with their gates,
preflight D re-run, `user_id SET NOT NULL`, the `server_or_lapsed` CHECK with the dead-row lapse,
`drop index feed_subscriptions_license_feed_tier_live_uidx`, and the v1.49 5(b) FK switch. This
spec designs ONE file with all of them, because (a) the header calls the whole list "(iii)", (b) the
CHECK must exist before the 0081 index goes or a live row with NULL server would be covered by no
unique index (NULLs are distinct under the 0086 server index), and (c) the section-3 re-run is what
makes the `request_id` DROP COLUMN lossless (section 3 step 2). The order below isolates the three
named statements as steps 8-9 so a split is a file boundary, not a redesign. RULED (fable Q1): one
file, "Kai's (b) is the decisive reason"; steps 8-9 stay isolated; no split asked for.

**Fable S1, owner agreement (not in the 0086 header; fable's correction of fable's own v1.60):** "the
tighten must gate and then constrain sr.user_id = licenses.user_id. Ledger: v1.56 Ruling A ('the
tighten re-runs the section-1 backfill from licenses.user_id and gates that stored agrees with
computed before set not null; a CHECK/composite-FK against the licence owner is the target'),
v1.60 (2)(b), v1.61 (5) ('what B waits on is user_id NOT NULL + the owner CHECK')." Lands in
step 1 (gate) and step 7 (constraint).

---

## 3. `db/migrations/0088_tighten.sql` -- statement order, each step with its guard

One transaction, `begin` ... `commit`, DO-block gates that `raise exception` (whole transaction
aborts) or `raise notice` with counts, the 0086 discipline. Marcus dry-runs it once with `rollback`
in place of `commit` and pastes every notice line, then runs it for real (section 9). Header: what
the file does, in order, with file/line/ledger-version references only; no sentence about who
decided or ruled anything (the 0084 rule, marcus m49169). The header also carries, verbatim:
- the step-2b line (fable S2): "literals present only when the cited word is on the thread; a run
  without the word aborts at step 3 / step 5 as designed";
- the after-apply note (fable Q5, section 6): "the vendor record set is complete after this file;
  a provider surface may present it as the truth of what the provider was told";
- the step-2 gate form (fable N3): "the gate is the v1.55 DISTINCT form: `count(distinct
  legacy_feed_tier_request_id) = legacy_rows - skipped` plus `envelopes = details`";
- the deploy-instant literal `2026-09-12T22:58:19Z` with its RULED source comment, Leo's text
  verbatim (fable S3, m49281_mtz1czu5; the same comment in both 0088 files and in section 9 item 6):
  `Vercel deployment dpl_6SggmsWv7raHRi7vHUu6k6C33rfV ready 2026-09-12T22:58:19Z,
  meta.githubCommitSha=3ded80d, read by leo m49262`.
The provenance labels in this list ("fable S2", "fable N3", "fable S3") are for THIS document; the
SQL header carries the texts without who-ruled (0084 rule, fable m49479 note). The step-2b comments
that cite coxwell's message id stay: that is the ruled provenance form for a literal.

**0. The run's `now()`, then the ledger row preflight.** AMENDED by R14: the first notice of the
run, before any check, is `raise notice 'run now()=%', now();` (0088:177). `now()`, not
`clock_timestamp()` and not a literal, because it is the function every predicate in the file
calls, so the stamp cannot disagree with what the predicates saw. It is printed before the ledger
checks so that an aborting run still stamps itself. Then: `schema_migrations` has `'0086'` and does
not have `'0088'`; else abort. `'0087'` is neither required nor forbidden: Leo's feed_tiers
connection-fields migration is PARKED (marcus m49474_mtzsh4hu: number reserved, not merged, not
applied), touches only `feed_tiers`, and is independent of this file; the step-0 comment says so
(fable T5).

**1. Section 1 re-run, then the owner gate (header 93-95; fable S1(a)).** `update
server_registrations sr set user_id = l.user_id from licenses l where l.id = sr.license_id and
sr.user_id is null`; gate `count(*) where user_id is null = 0` else abort. Second gate, S1(a):
```
select count(*) from server_registrations sr
join licenses l on l.id = sr.license_id
where sr.user_id is distinct from l.user_id;   -- must be 0, else abort, rows named
```
Fable wrote `sr.user_id <> l.user_id` in S1; `is distinct from` because `licenses.user_id` is
nullable (0001:51, my read) and a NULL licence owner would pass `<>` silently and then fail step
7's composite FK with Postgres's message instead of ours. Operator CONFIRMED by fable
m49231_mtz0pepn, fable's words (re-quoted in m49478): "`<>` is NULL-blind. Gate in step 1 and the
section-11 read both become `where sr.user_id is distinct from l.user_id`." Fable's S1(i) sentence,
verbatim (m49231 via m49478, missing from v3): "If nonzero, the rows are named and the file aborts
at step 1; disposition is coxwell's (claim or delete), not a default." The abort message names the
mismatched rows AND carries a second count, also m49231: licences with `user_id` NULL that have
any `server_registrations` row,
```
select count(*) from licenses l
where l.user_id is null
  and exists (select 1 from server_registrations sr where sr.license_id = l.id);
```
so an unclaimed licence bound to a server is named as the cause, not left to be inferred from the
mismatch. Expected 0 and 0 (0086 backfilled from `l.user_id`; Leo's writer takes `user_id` from
a session proven to own the licence, v1.56; marcus's 23:37Z NULL-safe read of both, in
m49385 (B): 0 and 0). Expected UPDATE 0 on prod (Leo's writer has been live since 3ded80d; the
window rows are those registered between 17:30Z and `2026-09-12T22:58:19Z`, the phase-2 deploy
instant, S3). `updated_at` untouched (0086 rule).

**2. Section 3 re-run with predicate (iv) (header 109-110, Source M).** Same two temp tables and
two INSERTs as 0086 lines 230-244 and 446-497, with ONE change: `tmp_0088_skipped_requests` adds
```
  and not exists (select 1 from access_requests a where a.legacy_feed_tier_request_id = ftr.id)
```
as the fourth conjunct. The envelope upsert keeps `on conflict (id) do update ... where
access_requests.decided_at is null` (0086:483-488, Source I strike 6) so no decision made through
the new path is reverted. Same gate as 0086:504-530, which IS the v1.55 DISTINCT form (fable N3;
my read: 0086:514 `count(distinct legacy_feed_tier_request_id)`, :521 `envelopes = details`, :524
`mapped = legacy_rows - skipped`), and the header says so in those words. Then the
`access_request_id` backfill from `request_id` at tier grain (0086:542-548) and its gate
(0086:551-565): `count(*) from feed_subscriptions where request_id is not null and
access_request_id is null = 0`. THIS GATE IS THE READER CHECK FOR STEP 8: after it, every fact
`request_id` carried is carried by `access_request_id` (row-level) plus
`access_requests.legacy_feed_tier_request_id` (request-level), so the DROP COLUMN loses nothing.

**2b. Coxwell dispositions (fable S2; the v1.49 3a pattern: named literals ahead of the gate, in
the same file).** A block that holds literal UPDATEs ONLY, each under a comment citing the bus
message id and date of coxwell's word. EMPTY BY DEFAULT. The gates in steps 3 and 5 stay exactly
as strict as written; a run without the word aborts there as designed. Three literal shapes may
appear, none present until the cited message exists:
- (a) 31cd1813 (pending, licence expired 09-01, Source N; no envelope by construction, so step 3
  aborts on it every run; no code path can reject it, companion grep = Q26 NO):
  ```
  -- coxwell <message id>, <date>: reject
  update feed_tier_requests
  set status = 'rejected', actioned_at = now(), reason = '<coxwell, message id, date>'
  where id = '31cd1813-5994-4946-bc3e-b5e1f3a52f64' and status = 'pending';
  ```
  The row then drops with the table in step 9 as a rejected row; provenance = step 3's notice
  paste + the ledger.
- (b) worded lapse of a live no-server row (step 5's BLOCK set; fable S2(b)):
  ```
  -- coxwell <message id>, <date>: lapse
  update feed_subscriptions
  set status = 'lapsed', lapsed_at = now(), updated_at = now()
  where id in ('<row id>', ...);
  ```
  `lapsed_at = now()` here, not `ends_at` (fable Q2: "a decision, dated when taken"). The other
  resolution needs NO literal: coxwell's client registers a real server row through the existing
  registration flow before the run, and step 4's licence -> server backfill re-keys the rows
  (v1.52's "known IP on the vendor allowlist" case). Marcus m49215: the 6 live rows are coxwell's;
  giang registers a real server (recommended) or worded lapse; rasoolx55 likewise. The 31cd1813
  literal in (a) lives HERE, in this file, not in a separate SQL file (fable closed CONFLICT 2 that
  way; marcus m49385 item 3).
- (c) a legacy `approved`-only row coxwell says WAS told (fable Q4): one literal INSERT into
  `feed_allowlist_records` per member tier, expanding packages exactly as section 5 does, under
  the same comment form. Silence = no carry. RULED (fable T6, m49479): these rows ARE carries.
  `told_at` = the legacy row's `actioned_at`, exactly the section-5 shape (`ip = sr.declared_ip`;
  section 11 read (1) proves every legacy `actioned_at` is below the S3 literal, so the rollback's
  `told_at < literal` bound deletes them). Their count is the summary's `allowlist_carried_by_word`
  (0 when the slot is empty) and the section-4 guard counts them (step 10, section 4).

**3. Disposition preflight (Source N, header 89-92).** List, one notice line per row, every
`feed_tier_requests` row with no envelope:
```
select ftr.id, coalesce(u.email, u.display_name, u.id::text) as requester, ftr.tier_key,
       ftr.status, ftr.created_at, l.expires_at as licence_expires_at
from feed_tier_requests ftr
left join users u on u.id = ftr.user_id
left join licenses l on l.id = ftr.license_id
where not exists (select 1 from access_requests a where a.legacy_feed_tier_request_id = ftr.id)
order by requester, ftr.created_at, ftr.id;
```
Any listed row with `status = 'pending'` (or `approved`/`provisioned`, which cannot be in this set
after step 2 unless section 3's join lost it, so also abort) aborts the transaction, named. Rows
with `status = 'rejected'` are noticed and drop with the table in step 9. Expected today: the one
row 31cd1813 (Source N), listed as `rejected` via step 2b(a) and the run continues; without the
2b literal it is `pending` and the file aborts here, as designed. Runs AFTER step 2 so a row the
old code wrote in the window and step 2 just carried is not listed.

**4. Section 4 re-run (header 93-95).** `server_registration_id` backfill via licence -> server
(0086:581-585) and its gate (`left_null = no_server`, 0086:590-604); `ends_at` re-seed for rows
still NULL, non-trial from the licence and trial from `feed_tier_trials` (0086:610-629); gate
`active rows with ends_at NULL = 0` (0086:633-648). Expected UPDATE 0 / 0 / 0 on prod (phase-2
writers set all three columns; 0086 spec section 10 step 7 is the post-deploy invariant).

**4b. Refusal gate, then the predicate lapse (NEW in R9, section 12; marcus m50350_mu0ztzip
2026-09-14, narrowed by the Z1 ruling m50396_mu10majx the same day).** The lapse leaves step 5 and
becomes its own step, on the predicate `status <> 'lapsed' and ends_at < now() and
server_registration_id is null`. `<` not `<=`: marcus's wording, and the knife-edge it leaves
(`ends_at` exactly equal to the transaction's `now()`) is closed by a named abort in step 5 rather
than by a 23514 out of ADD CONSTRAINT. The `server_registration_id is null` conjunct is marcus's Z1
ruling, option (a), on fable's strike (m50391_mu10l45h Z1): R9 as first built dropped it and so
lapsed 3 rows of a client who HAS a server row and was never in the no-server blocker table
coxwell ruled on -- "it exceeds the authorisation", and "a step that alters client records without
advancing its own purpose should not run", since the CHECK the lapse exists to unblock only looks
at NULL-server rows. Marcus's general rule from the same message: "a literal can under-reach; a
predicate can over-reach. Neither is safe by category -- the test is whether the set it selects is
the set that was authorised."
Before the UPDATE, one notice per candidate (`step 4b candidate:` -- id, subscriber, tier,
`server_registration_id`, `ends_at`, computed status, reason), fable's Z2 in m50391_mu10l45h, so
the operator's list of movers comes from the same run's `now()` as the move. Then the gate: every
candidate row must ALREADY compute `lapsed` under
`EFFECTIVE_STATUS_SQL` (`src/lib/feed-subscriptions.ts:140-159`, blob `94fa705` at branch head
`e1835fb`, with `REGION_TO_FEED_TYPE_SQL` from :114), transcribed into the migration with
`s -> fs` and a LEFT join to `feed_tiers` so a `provider_tier` row is named rather than dropped.
A candidate that computes non-lapsed is a row a client can still see; the file aborts and names
each with the branch keeping it alive (live licence / live trial / ungated region / cme). Marcus's
prod read of 2026-09-14 08:41Z (m50350_mu0ztzip, MARCUS'S read, not mine): 21 rows / 7 clients match
the un-narrowed predicate and `effective_status = 'lapsed'` on every one; after the Z1 conjunct
the candidate set is the 18 rows / 6 clients of those that have no server row, and the gate is
empty TODAY on either reading -- which
is exactly why it is in the file. That read proves the flip safe on the day it was taken and says
nothing about the day the file is applied; this file has already sat unapplied for two days while
its own committed six-uuid list went stale underneath it. A migration that re-checks its own
precondition cannot be overtaken by time. Counts `fs_predicate_lapsed` /
`fs_predicate_lapsed_clients` into the summary; expected 18 / 6 (Z1), as a read, not a gate.

**5. NULL-server disposition, then the CHECK (header 80-86).** Listing, one notice per row, of
every `feed_subscriptions` row with `server_registration_id is null`: `id, subscriber, tier,
status, ends_at, computed = (ends_at > now() or ends_at is null)`. Predicates are fable S4's,
verbatim: live = `status <> 'lapsed' and (ends_at > now() or ends_at is null)` (NULL `ends_at` =
live, v1.53/v1.55 reading; `status <> 'lapsed'` rather than `in ('trial','active')` so a row with
any other stored status cannot slip past both branches and fail at ADD CONSTRAINT with Postgres's
message instead of ours). Then:
- RE-AMENDED by R9 (section 12, marcus m50350_mu0ztzip 2026-09-14), which governs: the six
  committed uuids are STRUCK, and with them the SUBSET gate, the EXISTENCE gate, the
  `fs_exempt_live` notice and the `live <> exempt_live` consistency abort. The lapse moves to 4b.
  What is left of this step: list every NULL-server row; compute the CARVE-OUT
  (`server_registration_id is null and status <> 'lapsed' and (ends_at > now() or ends_at is
  null)` -- marcus's predicate, with `or ends_at is null` kept from S4); name each carve-out row;
  abort naming any NULL-server non-lapsed row the carve-out does not cover (only reachable at the
  `ends_at = now()` knife-edge, fix = re-run); then build the CHECK by `execute format` over the
  computed ids. The exception stays keyed BY ID, not by predicate: `or ends_at > now()` in the
  constraint would admit every future NULL-server row, which is the thing the constraint exists to
  refuse. An empty carve-out drops the `id in` clause entirely. Counts `fs_carve_out` /
  `fs_carve_out_clients` / `fs_no_server_listed`; expected 6 / 2 / 27 on marcus's 08:41Z read, as
  a read and not a gate -- 3 after 09-19, 0 after 09-25. The text that follows is history.
- AMENDED by R4 (section 12, fable v1.71): the count below must EQUAL the six exempt ids, not 0;
  any other live no-server row still aborts, and an exempt id that is not a live no-server row
  aborts too. The text that follows is the pre-R4 form, kept for the history of S2(b).
- RE-AMENDED by R5 (section 12, fable v1.75): set-equality is STRUCK. Gate = SUBSET (every live
  no-server row is one of the six, else abort naming each) + EXISTENCE (each of the six is a
  `feed_subscriptions` row, else abort naming it). The notice names which of the six are still
  live; summary `fs_exempt_live` = that count; any 0..6 passes. Order inside the step: gate ->
  lapse -> CHECK, never CHECK before lapse (marcus's ~13:37Z read: 18 active rows with
  `ends_at <= now()` and NULL server, all on licences with zero server rows; only the lapse
  converts them). 2b(b) asserts every staged id is one of the six AND live with NULL server.
- BLOCK (v1 wording restored; section 12 R1 withdrawn by marcus m49215, fable S2(b) governs):
  ```
  select count(*) from feed_subscriptions
  where server_registration_id is null and status <> 'lapsed'
    and (ends_at > now() or ends_at is null);   -- must be 0, else abort, every row named
  ```
  Marcus's read 23:22Z (m49188): 6 such rows, two subscribers x 3 tiers (giang2000ln paid to
  09-19, rasoolx55 trial to 09-25; v1.52 sharpening 3). Both resolutions are coxwell's and both
  are step 2b(b): a real server row registered before the run (step 4 re-keys the rows, no
  literal), or coxwell's worded lapse (literal in 2b, `lapsed_at = now()`). No synthetic server row.
- LAPSE the dead ones inside the transaction (S4 predicate; Q2 RULED `coalesce`):
  ```
  update feed_subscriptions
  set status = 'lapsed', lapsed_at = coalesce(lapsed_at, ends_at), updated_at = now()
  where server_registration_id is null and status <> 'lapsed' and ends_at <= now();
  ```
  `lapsed_at = coalesce(lapsed_at, ends_at)` RULED (fable Q2: "the truthful instant is the seeded
  end; dating a 09-06 expiry to the tighten would be a fiction"). Condition fable set: "0071 has
  `lapsed_at`" is my read, so marcus's section-11 reads gain the `information_schema.columns`
  SELECT for `feed_subscriptions`. Computed status does not move for these rows (they already
  compute `lapsed` through the licence branch, `l.expires_at > now()` false); stored status now
  agrees with computed. Test plan names them as the ONLY stored-status movers and ZERO computed
  movers, with fable's S4 caveat (section 9 item 4).
- THE CHECK (header :75-76 target statement, verbatim), now that no non-lapsed row has a NULL
  server:
  ```
  alter table feed_subscriptions add constraint feed_subscriptions_server_or_lapsed_chk
    check (status = 'lapsed' or server_registration_id is not null);
  ```
  AMENDED by R4: `or id in (<the six literal uuids>)` is appended, the exception 0089 removes.
  RE-AMENDED by R9: the appended clause is `or id in (<the carve-out ids computed in this step>)`,
  written by `execute format` and read back out of `pg_get_constraintdef` for the proof; no uuid
  literal is written into any file. 0089 reads the same text back to learn what it must settle.
  STAYS (marcus m49215 withdrawing m49207: "'server without licence' (Arm B, legitimate)" is
  not "'live subscription without server' (not legitimate post-tighten)"; fable Q1 reason (b),
  Q6; fable m49231_mtz0pepn, confirmed landed in m49478: "CHECK STAYS, step 5 stays BLOCK, no
  no-server partial index"). Column stays nullable (v1.52: a lapsed row may keep NULL server forever). Not `not
  valid`: steps 2b + 5 make it hold at ADD, and the failure is ours, named, before Postgres's.

**6. Preflight D re-run, then drop the 0081 index (header 77, 95-97; fable Q1 ordering: CHECK
before the drop).** AMENDED by R4 (section 12): preflight D stays but counts only rows with a
NOT NULL server (the carve-out rows share three tiers and GROUP BY would fold their NULL servers
into three false duplicate groups); the 0081 drop MOVES OUT to 0089. The rest of this step is
the pre-R4 text. Duplicate groups on `(server_registration_id, feed_tier_id)` among live rows
(0086:327-344) must be 0 (structurally true: `feed_subscriptions_server_feed_tier_live_uidx`
exists since 0086 and covers every live row whose server is NOT NULL, and after step 5's CHECK
every live row has a NOT NULL server, so no live row is outside it). Then `drop index if exists
feed_subscriptions_license_feed_tier_live_uidx;`. Nothing in `src` names that index in an `ON
CONFLICT` (my grep: the only mentions at 9e84f16 are the comment at feed-subscriptions :392 and the
comment at access-requests :323); the window check at :403-410 is a plain SELECT and keeps working
until the section-8 cleanup deletes it. No replacement index (the 6f2ada9 R3 no-server index is
withdrawn with R3, section 12: with the CHECK in place its predicate set, live rows with NULL
server, is empty by construction, and the cross-half question R3 raised is moot for the same
reason). Not dropped: the 0078 `provider_tier` twin
(`feed_subscriptions_subscriber_provider_tier_live_uidx`), outside the ledger's list.

**7. server_registrations: `user_id SET NOT NULL`, then the owner FK (header 74, 148-150; fable
S1(b), shape as fable wrote it).** `alter table server_registrations alter column user_id set not
null;` (gate = step 1). Then, in order:
```
alter table licenses add constraint licenses_id_user_id_key unique (id, user_id);
-- additive; id is already the PK so it always holds
```
then, in a DO block that looks the 0031 FK up by `conrelid = 'server_registrations'::regclass and
confrelid = 'licenses'::regclass and contype = 'f'` (0031 created it unnamed, so the default name
`server_registrations_license_id_fkey` is expected but not assumed): drop it, notice the name it
found, and add
```
alter table server_registrations
  add constraint server_registrations_license_owner_fkey
  foreign key (license_id, user_id) references licenses (id, user_id)
  on delete set null (license_id);
```
Fable S1(b), verbatim: "MATCH SIMPLE (default) means a licence-less row (license_id NULL) is not
checked, which is exactly B's row; `on delete set null (license_id)` nulls only the licence
column, so user_id NOT NULL survives a licence delete (v1.49 5(b)'s reason). The column-list form
of SET NULL needs Postgres >= 15 ... ON UPDATE stays NO ACTION: today the only writer of
licenses.user_id is claimPendingLicense NULL->owner (v1.56), so a future licence-transfer path
fails loudly at this FK". The constraint name is mine (0031's was unnamed); fable may rename in
the hunk read. `unique (license_id)` kept as-is, plain (Source B: swap dropped; fable Q7 close:
"v1.49 governs ... the swap is retired for good in v1.63"). No writer NULLs `license_id` in this
file and none exists in code (section 7). Gate for the ADD = step 1's second count (0 rows where
`sr.user_id is distinct from l.user_id`), so the FK cannot fail on data this file did not name.

**8. `request_id` goes (Source C, header 78-79).** Guard, re-run immediately before: `count(*)
where request_id is not null and access_request_id is null = 0` (step 2's gate, repeated so the
DROP cannot be separated from its proof by a later edit); notice `count(*) where request_id is not
null` for the record. Then `drop index if exists feed_subscriptions_request_tier_uidx;` (0079) and
`alter table feed_subscriptions drop column if exists request_id;` (takes the 0078 FK to
`feed_tier_requests` with it, which is why this step precedes step 9). Reader proof: line one of
this document.

**9. The 'provisioned' carry, then `drop table feed_tier_requests` LAST (Source G(d), Source N).**
Section 5 has the carry's SELECT, guards and INSERT; it runs here, after every other reader of the
old table is done and before the drop. Then the drop guard: `count(*) from pg_constraint where
confrelid = 'feed_tier_requests'::regclass` must be 0 (any FK still pointing at the table = a
reader this spec missed; after step 8 the 0078 FK is gone and 0086 created none), and step 3 must
have passed. Then `drop table feed_tier_requests;` (its two 0034 indexes go with it). Nothing else
references it: `git grep` in `src` = 13 comment lines (line one, companion grep).

**10. Summary SELECT and the ledger row.** AMENDED by R14: the first column is `now() as run_now`
(0088:1284), the same instant step 0 printed. It is in both places because the two carry different
jobs: step 0 stamps the run before anything can abort it, and the summary column keeps the instant
in the same row as the counts it dates, which a split paste cannot separate. It is also the only
thing in either paste that says WHICH run it is -- the dry-run and the apply execute byte-identical
SQL and differ only by their clock and the data (marcus m50485_mu11vkq7, 2026-09-14).
AMENDED by R9: `fs_no_server_live` is no longer 0 -- it
equals `fs_carve_out` by construction -- and `fs_exempt_live` / `fs_no_server_lapsed_now` are
replaced by `fs_no_server_listed`, `fs_carve_out`, `fs_carve_out_clients`, `fs_predicate_lapsed`
and `fs_predicate_lapsed_clients` (expected 27 / 6 / 2 / 18 / 6 on marcus's 08:41Z read as narrowed
by the Z1 ruling, section 12 R10, as reads, not gates). Pre-R9 text follows. One row: `sr_user_id_null` (0), `sr_owner_mismatch`
(0, step 1 second gate), `fs_no_server_live` (0, step 5 gate), `fs_no_server_lapsed_now` (step
5's UPDATE count), `fs_lapsed_by_word` (step 2b(b) row count, 0 when the slot is empty),
`fs_request_id_column_present` (false, from `information_schema.columns`), `ftr_table_present`
(false, from `to_regclass`), `allowlist_carried` (section 5 count), `allowlist_carried_by_word`
(step 2b(c) INSERT count, 0 when the slot is empty; fable T6), `allowlist_open_total`,
`access_requests_rows`, `legacy_no_envelope_rejected` (step 3's rejected count, dropped). Then
`insert into schema_migrations (version, name) values ('0088', '0088_tighten.sql') on conflict do
nothing;` `commit;`

---

## 4. `db/migrations/0088_rollback.sql`

Same discipline as 0086_rollback.sql: written in the same commit, never run automatically, states
what it cannot restore first. Reverse order of section 3. Preflight: `schema_migrations` has
`'0088'`, else abort (nothing to roll back); has no `'0089'`, else abort (0089_rollback.sql first).
AMENDED by R4 (section 12): the 0081 index is NOT recreated and its duplicate-group preflight is
gone (0088 no longer drops it; both live in 0089_rollback.sql); the CHECK dropped is the one with
the six-id exception. The 0081 sentences below are the pre-R4 text.

Cannot restore exactly, said up front:
- `feed_tier_requests` rows. The rollback recreates the 0034 shape and repopulates it FROM the
  envelopes (`access_requests where legacy_feed_tier_request_id is not null`, joined to
  `feed_tier_request_details` and `feed_tiers`): `id = legacy_feed_tier_request_id`, `user_id`,
  `license_id = server_registrations.license_id` via the detail's server row, `region =
  feed_tiers.region_key`, `tier_key`, `status` (`approved` for both former `approved` and
  `provisioned` -- the distinction is NOT recoverable from the envelope; the carried allowlist
  rows are the only trace), `reason`, `created_at`, `actioned_by = decided_by`, `actioned_at =
  decided_at`. A package request comes back as N single-tier rows sharing nothing but `id`, which
  violates the primary key, so the repopulation is `insert ... on conflict (id) do nothing` and
  keeps the first member only (named in a notice). Rows step 3 listed as `rejected` with no
  envelope are gone; their provenance is 0086 section 6's notice paste and step 3's notice paste.
- `feed_subscriptions.request_id` values: re-added nullable, backfilled as
  `access_requests.legacy_feed_tier_request_id` via `access_request_id` (exact for every row that
  had one, since step 2's gate proved the mapping total; NULL for new-path rows, correct).
Restores exactly: 0078 FK (`request_id references feed_tier_requests(id)`, after the table is
back), 0079 index `feed_subscriptions_request_tier_uidx`, the 0081 index
`feed_subscriptions_license_feed_tier_live_uidx` (preflight in the rollback: zero live `(license_id,
feed_tier_id)` duplicate groups, else abort), `alter table feed_subscriptions drop constraint if
exists feed_subscriptions_server_or_lapsed_chk`, then the step-7 reverse in fable's S1 order:
`alter table server_registrations drop constraint server_registrations_license_owner_fkey`,
re-add `foreign key (license_id) references licenses(id) on delete cascade` (the 0031 shape; name
noticed), `alter table licenses drop constraint licenses_id_user_id_key`, `user_id DROP NOT
NULL`; delete the carried allowlist rows (`told_at < '2026-09-12T22:58:19Z'`, the phase-2 deploy
instant, S3, fable m49281_mtz1czu5: new-path records cannot predate the deploy, and a legacy row
actioned in the 17:30Z-22:58Z window carries a `told_at` inside that window, which the v1 bound
17:30Z missed; the literal sits under the ruled source comment, section 3 header; guard = that
count equals the summary's `allowlist_carried + allowlist_carried_by_word`, else abort, because
the step-2b(c) rows are carries too, fable T6), delete the `'0088'` ledger row. The case option
(a) ACCEPTS, named so nobody "fixes" it with a pad (fable T2, m49281 "loud-and-stuck beats
silent-and-wrong"): a legacy row actioned in the alias window AFTER the literal carries `told_at >=
literal`; the rollback's bound misses it, the count guard aborts and nothing is deleted. That is
the chosen failure mode; the remedy is a ruling on the thread, never a wider bound. Section 11
read (1) (`actioned_at >= literal` = 0) is the apply gate that keeps the case empty. The step-5
lapse is NOT reverted (stored `lapsed` on a row whose `ends_at` is past is truthful either way);
the step-2b(a) and 2b(b) literals are NOT reverted (coxwell's decisions, dated); the 2b(c)
records ARE deleted with the section-5 carries (the rollback restores the pre-tighten record set,
which had no legacy carries; coxwell's word stays in the ledger and in the 2b comment). All three
stated, not hidden.

---

## 5. Item (2): the 'provisioned' carry into `feed_allowlist_records`

Source G(d) fixes the columns: (server, tier, `declared_ip`, `told_at = actioned_at`). Package
literals expand exactly as 0086 section 3 did (a provisioned `ld-retail-package` was told to the
vendor as three IPs-on-tiers). The enumerating SELECT, read-only, for marcus to run on prod now and
to paste (this is the list coxwell confirms per Source G(d), "declared_ip may have changed since"):

```
select ftr.id as legacy_id,
       coalesce(u.email, u.display_name, u.id::text) as requester,
       ftr.tier_key as requested_key,
       ft.tier_key as member_key,
       sr.id as server_registration_id,
       ft.id as feed_tier_id,
       sr.declared_ip as ip,
       ftr.actioned_at as told_at,
       sr.updated_at as server_row_last_edited
from feed_tier_requests ftr
left join users u on u.id = ftr.user_id
join server_registrations sr on sr.license_id = ftr.license_id
join feed_tiers ft
  on ft.tier_key = ftr.tier_key
  or (ftr.tier_key = 'ld-retail-package' and ft.tier_key in ('ld-beta-56', 'ld-gamma-19', 'ld-delta-18'))
  or (ftr.tier_key = 'ny-retail-package' and ft.tier_key in ('ny-fast', 'ny-normal'))
where ftr.status = 'provisioned'
order by requester, ftr.actioned_at, ft.tier_key;
```
`server_row_last_edited > told_at` is the "IP may have changed since" flag for coxwell's eye; it is
display only, not a predicate.

Count on prod: not in my reads. 0086 preflight C printed it at apply as `provisioned_to_map=%`
(0086:321-322); marcus has that notice line, and `select count(*) from feed_tier_requests where
status = 'provisioned'` re-reads it. Section 11 lists both.

Guards inside the migration, before the INSERT, each abort-with-names:
- (a) every `status = 'provisioned'` row has a server row (`left join server_registrations ... where
  sr.id is null` = 0). 0086 preflight C already blocked on this class ("approved/provisioned with
  no server = the vendor was told an IP this database never held (Q25's class), never a skip",
  0086:222-223), so it holds today; re-checked because a row could have been actioned in the
  17:30Z-22:58Z window.
- (b) every such row has `actioned_at is not null` (the ledger's `told_at = actioned_at` has no
  fallback; a NULL here is coxwell's to date, not mine to default).
- (c) every such row's `tier_key` resolves to >= 1 `feed_tiers` row (0086 preflight C's strict
  check, repeated).
INSERT, same `not exists` shape as the phase-2 writer (feed-subscriptions.ts :425-431, S1 guard on
(server, tier, ip) open), plus `on conflict (server_registration_id, feed_tier_id, told_at) do
nothing` for the PK:
```
insert into feed_allowlist_records (server_registration_id, feed_tier_id, ip, told_at)
select c.server_registration_id, c.feed_tier_id, c.ip, c.told_at
from tmp_0088_carry c
where not exists (select 1 from feed_allowlist_records r
                  where r.server_registration_id = c.server_registration_id
                    and r.feed_tier_id = c.feed_tier_id and r.ip = c.ip and r.revoked_at is null)
on conflict (server_registration_id, feed_tier_id, told_at) do nothing;
```
where `tmp_0088_carry` is the SELECT above. Post-gate: for every distinct (server, tier, ip) in
`tmp_0087_carry` an open record exists (count of misses = 0). Notice: rows enumerated, rows
inserted, rows skipped because an open same-IP record already existed (a legacy grant that was
ALSO re-approved through the new path since 22:58Z).

RULED (fable Q4): legacy rows with `status = 'approved'` that never reached `'provisioned'` get NO
record by default. Fable's words: "'approved' is a decision; 'provisioned' is the vendor told; only
the second is allowlist truth (v1.49 2(d)). Coxwell sees the approved-only list (section 11); if
he says a listed row WAS told, it is carried by a literal in step 2b (S2) with his message id,
expanding packages exactly as section 5 does. No default carry." Marcus's read (m49188):
8 approved rows today.

`told_by` (Source I, optional): RULED (fable Q3) NOT ADDED. Fable's named cost, accepted: "carried
rows can then be back-filled from nothing (actioned_by is gone with the table)". A later
one-column migration plus a writer change if coxwell ever wants it; not this file.

After this step the vendor record set is no longer PARTIAL (0086 spec section 9 interval
statement; section 11 item 4): every grant the vendor was told about under the old flow and every
grant approved or directly granted under the new flow has an open record.

---

## 6. Item (3): the provider-panel unlock

RULED (fable Q5): PERMISSION ONLY in this slice. "No UI file is opened in the 0087 job; section 6
collapses to one sentence in the migration header's after-apply note: 'the vendor record set is
complete after this file; a provider surface may present it as the truth of what the provider was
told'." The Subscribers-page shape below is banked in the ledger as the spec of a separate
provider-panel slice, Leo's files, sequenced by marcus after B-1. Kept here as the record of what
was banked; nothing in it is built by this job.

The ledger's section 9 paragraph, verbatim and whole (fable Q7, fable's text): "It does not authorise
anything. It does not model entitlement, billing, or renewal. It does not touch the provider panel
except to lock it. It does not automate anything. It does not change server_registrations. It
gives coxwell a document to approve, amend, or reject, in place of five bus round-trips that
nobody will read again." The lock is fable's section 1.7 fact made a rule: "Every provider-reachable
surface ... goes through maskIdentity() or a pseudonym-only select. No IP column is selected
anywhere on a provider path." Fable records my read (declared_ip on Subscribers/Revenue at 9e84f16
:535, :540) as a change made since, in Leo's provider-panel work, unverified by fable.

What I had in v1, verbatim from `docs/specs/0086-phase2-code.md` section 9 (P2 interval statement):
"between this deploy and the tighten, the vendor record set (`feed_allowlist_records`) is PARTIAL.
It carries rows only for grants approved or directly granted through the new path; the
`'provisioned'` carry of legacy grants is the tighten's (section 11 item 4). The provider panel is
locked per ledger section 9 in that interval (fable m48897, marcus m48906): no provider surface
presents the record set, and provider approve (C2, section 4(c)) writes through the same path
without reading it. Nobody reads the allowlist set as the truth of what a provider has been told
until the tighten lands."

Facts at 9e84f16 (my reads): `feed_allowlist_records` has exactly one reference in `src`, the
INSERT at feed-subscriptions.ts :425-431. No page reads it. The provider's Subscribers and Revenue
pages read `listSubscribersForProvider` (:516-568), whose "server IP" column is
`server_registrations.declared_ip` joined ON `s.license_id` (:535, :540), i.e. the client's CURRENT
declared IP, not what the vendor was told.

The unlock = the lock's negation: after 0088 applies, a provider surface MAY present the record set
as the truth of what the provider has been told. The shape as banked (fable Q5; NOT built here):
- Subscribers page (`/feed/dashboard/subscribers`), the one place the provider already sees an IP:
  the IP column reads the OPEN allowlist record for the row's (server, tier) --
  `left join feed_allowlist_records r on r.server_registration_id = s.server_registration_id and
  r.feed_tier_id = s.feed_tier_id and r.revoked_at is null` -- labelled as the IP the provider was
  told, with `told_at`. `declared_ip` is shown beside it only when it differs, as "client now
  declares X", so a changed IP is visible to the person who has to re-allowlist. The
  `server_registrations` join moves to `s.server_registration_id` (the grain since 0086) from
  `s.license_id`. A row with no open record (should be none after section 5; provider_tier rows
  are outside the allowlist model) renders the IP cell empty, never falls back to `declared_ip`
  silently.
- Overview (`/feed/dashboard`): no new stat. The ledger gives no overview line and the record set
  is per row, not a count that means anything to the provider.
- Provider approve: unchanged (writes through the same path; C2).
- Not in this job either way: the revoke write when a grant lapses and a list of open records
  whose subscription is no longer live (0086 spec 4(b), "a later slice").
Ownership: those two files are Leo's (section 1); kai does not open them in this job. The
migration header carries the one after-apply sentence quoted at the top of this section.

---

## 7. Item (4): the B-1 dependency

Fable's sentence, verbatim (Q7, v1.61 (6)): "B-1 (12 files, ~450-550 lines, no migration) as ONE
commit after the tighten AND after Kai's phase 2 is on main, because the 2c picker hunks in
feeds/actions.ts would otherwise conflict twice." The guard, v1.60 (3): "a server with no licence
REFUSES a feed request, a self-serve trial and a direct grant, until allocated ... Shape: one named
error at the same entry points as SoftwareRequestsNotShippedError / the no-server refusal (C3),
text 'Allocate a licence to this server first', and the 2c picker lists unallocated servers
DISABLED with that reason rather than hiding them" and "the guard is unreachable until B and ships
with B, not with phase-2". On "23502", v1.62 N2 as fable quotes it: "LockedServerRegistration.licenseId
nullable flows into NOT NULL feed_subscriptions.license_id = raw 23502 for a licence-less server,
no such row before B-1, guard ships with B-1". So the 23502 is on `feed_subscriptions.license_id`
(the approval INSERT), not on `server_registrations`; my v1 reading below was confirmed by fable as
"correct and complete". SUPERSEDED, kept as history (fable T3, m49479): six minutes after Q7,
fable's m49231_mtz0pepn corrected the fact from marcus m49219 item 3 (a marcus prod read, not mine):
`feed_subscriptions.license_id` is NULLABLE in prod. A licence-less server's subscription
therefore does NOT raise 23502; it inserts with `license_id NULL` and EFFECTIVE_STATUS_SQL
computes it lapsed, silently. The B-1 refuse-until-allocated guard is the ONLY guard, not a
pre-emption of a DB error. The 0088 SQL is unchanged by this (Q6 split: this file does not touch
that column); it matters to B-1's author, who reads this section to decide how hard the guard
must be.

What that binds in this file:
- Nothing here inserts or updates a `server_registrations` row with `license_id NULL`, and no code
  at 9e84f16 does either (server-registration.ts :180-195 always passes `licenseId`).
  `server_registrations.license_id` has been nullable since 0086 section 1, so no 23502 arises on
  that column; and per the T3 correction above none arises on `feed_subscriptions.license_id`
  either (nullable in prod), so the B-1 refusal is the only thing standing between a licence-less
  server and a silently-lapsed subscription. This file only makes the
  schema ready for B-1, CONFIRMED by fable with S1 added: `user_id NOT NULL` (the owner survives a
  missing licence), the owner FK `on delete set null (license_id)` (a deleted licence no longer
  deletes the server, and leaves the owner), `unique (license_id)` kept plain (NULLs distinct, so
  N licence-less servers do not collide; "the swap is retired for good in v1.63"). The guard
  itself ships with B-1, not here.
- The window rule (Source B) is SPLIT by this file, RULED (fable Q6, v1.63). Fable's words: "The
  server_registrations half ENDS with 0087: user_id is NOT NULL (the DB holds the rule), and 'no
  writer NULLs license_id' on server rows is lifted because B-1's insert-new writes license_id
  NULL by design (v1.60). The feed_subscriptions half SURVIVES 0087: server_registration_id is
  enforced by the CHECK for every non-lapsed row, but license_id keeps being written until flip
  (c) runs, because EFFECTIVE_STATUS_SQL still joins licenses on s.license_id (Kai's read
  :144-146; v1.62 (e) confirmed untouched) and a NULL there computes lapsed." Phase-2 writers keep
  writing `license_id` from the server row (access-requests.ts :328-330; feed-subscriptions.ts
  :331) and this spec changes no writer. The section-8 comment rewrites cite v1.63 for the split,
  not "the tighten" wholesale.
- Order on main: phase-2 merge (3ded80d, done) -> this tighten (0088 applied, then the section-8
  cleanup commit) -> B-1. The cleanup commit is part of the tighten, not B-1.

---

## 8. Code cleanup after apply (declared in section 1; separate commit, after marcus confirms apply)

- AMENDED by R4 (section 12): the 0081 index survives 0088, so the second query and `licenseId`
  are deleted after 0089 is applied, not after 0088. The 0088 cleanup commit only re-points the
  REMOVAL POINT comment (:392-393) from "the tighten migration" to
  `db/migrations/0089_drop_server_or_lapsed_exception.sql`, and rewrites the other comments as
  below. The first bullet's deletion moves to the 0089 cleanup commit.
- feed-subscriptions.ts :388-411 `assertNoLiveGrant`: the `if (args.licenseId)` second query
  (:403-410, keyed on `license_id`) and the REMOVAL POINT paragraph (:388-393) go; `licenseId`
  leaves the args type; the two callers (access-requests.ts batch create and approval,
  feed-subscriptions.ts direct grant) drop the argument. Behaviour after: the new-key query
  alone (server, tier). No replacement query (the 6f2ada9 R3 subscriber-keyed rewrite is
  withdrawn with R3: with the step-5 CHECK there is no live server-less row for a second half to
  exist; the source is fable m49201_mtz0hlbm CLEANUP COMMIT, fable's words: "the check that remains
  is the server-key query, which after step 5+6 is the only live uniqueness (correct)"; v3
  mis-attributed this to m49231, corrected per m49478).
- feed-subscriptions.ts :37-45 and :1295-1302, access-requests.ts :323: comment text that says
  "until the tighten" / "or on the 0081 licence index" / "drops with the old table in the tighten"
  is rewritten to the past tense with the 0088 reference. Q6 split wording (fable, v1.63), in the
  comments where the window rule is named: "the server_registrations half of the v1.49 window
  rule ended with 0088 (user_id NOT NULL; B-1 writes license_id NULL by design); the
  feed_subscriptions half survives 0088: writers keep writing license_id until flip (c), because
  EFFECTIVE_STATUS_SQL still joins licenses on s.license_id". `fs.license_id` stops being written
  in flip (c)'s commit, not this one.
- S1(ii), CORRECTED by fable in m49479 T4 (the m49231 version, "a user delete errors at the
  composite FK", was wrong and is corrected in ledger v1.68): a user delete does two things in one
  statement. It cascade-deletes the user's server rows (`server_registrations.user_id ...
  references users(id) on delete cascade`, 0086:351-352 as merged, my read) and sets their
  licences' `user_id` to NULL (`licenses.user_id uuid references users(id) on delete set null`,
  0001:51, my read). The composite FK is ON UPDATE NO ACTION, which Postgres checks at the end of
  the statement, after the cascades, and finds no referencing row. So the delete SUCCEEDS, and the
  new FK changes nothing about user deletion. The FK's `on delete set null (license_id)` is only
  ever exercised by a licence delete, which is itself not a designed operation (fable N5). For the
  record, my run at the branch working tree (src = 9e84f16): `git grep -n -i "delete from users"
  -- src` = 0 lines. With no behaviour change, a hit is listed, not a gate.
- Nothing else: `request_id` has no reader to delete (line one), `feed_tier_requests` has no reader
  to delete (companion grep), `EFFECTIVE_STATUS_SQL` is untouched.
- Not deployed before the migration: the second query is harmless with the index gone (plain
  SELECT), so the order is migration first, cleanup second, never the reverse (the reverse would
  open the window check for the interval, which the window rows no longer need but which costs
  nothing to keep until the index is gone).

---

## 9. Item (5): test plan, section-10 discipline

No non-prod database. Three layers.

**Local, before handover (kai runs, pastes output):**
- `npx tsc --noEmit` clean (after the cleanup commit; the spec + migration commit has no TS).
- `npm run lint` clean on the touched files (project-wide lint has 3 pre-existing errors, none in
  kai's files; named in the report as before).
- Grep proofs at the cleanup commit: `git grep -n request_id -- src` = the 18 lines of line one
  (unchanged; the cleanup touches no `request_id` line); `git grep -n
  feed_subscriptions_license_feed_tier_live_uidx -- src` = 0 lines; `git grep -n "license_id = \$1
  and feed_tier_id" -- src` = 0 lines (the window query is gone); `git grep -n feed_tier_requests
  -- src` = the 13 comment lines or fewer.
- Migration file self-checks (read, not run: no psql here): every DO block either raises or
  notices; statement order matches section 3; header has no attribution sentence (grep the header
  for "ruled", "decided", "approved by", "coxwell", "marcus": 0 hits outside the thread id line).

**Prod, before apply, by marcus (SELECT only), pasted to the thread:** the section 11 list. In
particular the step-3 and step-5 listings, run stand-alone, so the disposition (31cd1813, the
no-server live rows) is known BEFORE the dry-run, not discovered by it. The two S3 APPLY GATES
(section 11 reads (1) and (2), fable T1, m49281 + m49294) are RE-TAKEN immediately before the
dry-run and again immediately before apply, pasted with timestamps; marcus's 23:50Z zeros are a
first take, not the gate. Nonzero = do not apply, back to the thread; the remedy is a ruling,
never a pad.

**Apply gate (all of these, none inferred):** coxwell's four words (fable m49201 apply gate: 31cd1813
disposition; the live no-server clients resolved; the section-5 carry rows confirmed; the
approved-only list, silence = no carry); the section-11 reads pasted by marcus including the two
S3 reads re-taken as above; marcus's dry-run paste. Nothing dispatched by fable.

**Prod, dry-run then apply, by marcus:**
1. Dry-run: the file with `rollback;` in place of `commit;`. Every notice line pasted. Expected:
   step 1 UPDATE 0; step 2 INSERT 0 / 0 unless the window wrote requests (then N, named); step 2
   gate `unmapped=0` (the v1.55 DISTINCT form, N3); step 1 owner gate 0 mismatches and 0
   NULL-owner licences with server rows; step 2b literals applied (row counts, each named), and for
   2b(b) in particular `step 2b(b) ok: staged=0 lapsed_by_word=0` with summary `fs_lapsed_by_word=0`
   -- the worded-lapse slot is EMPTY at this commit, the only `insert into tmp_0088_lapse_by_word` in
   the file being the commented template at 0088:426 (my grep at this commit), so no
   `step 2b(b) candidate:` line prints either; any re-cut that fills the slot names its rows in the
   same commit (fable m50501_mu124d6c ruling B -- R14 put the per-row `step 2b(b) candidate:` notice
   in ahead of the gate at 0088:472, which covers every staged id on the success path as well);
   step 3 lists 31cd1813 as `rejected` via 2b(a) and continues (without the literal: `pending`,
   abort here, as designed); step 4 UPDATE 0/0/0; step 5 BLOCK count 0 (without coxwell's
   resolution of the 6 live no-server rows: 6, named, abort here, as designed) and lapse count =
   the dead no-server rows (named; marcus m49188: 18 lapse-able + 3 stored-lapsed, a marcus read);
   CHECK added; preflight D 0; step 6 index dropped; step 7 FK name found, licences unique
   added, composite FK added; step 8 `request_id` rows with a value = the 0086 apply's
   `with_request` count, unmapped 0; step 9 carry enumerated = the `provisioned_to_map` count
   expanded by package membership, inserted = that minus same-IP overlaps with new-path records,
   misses 0; drop guard 0; summary row.
2. Before-read (v1.47 gate shape, S5(b)), carrying the inputs the CASE's two clocks read -- without
   them nobody can check step 4's cause (C) (fable Z6 fix 2, m50452_mu11gweq):

   ```sql
   select now() as read_at, s.id, s.subscriber_user_id, s.feed_tier_id, s.status, s.ends_at,
          s.lapsed_at, s.server_registration_id,
          l.status as licence_status, l.expires_at as licence_expires_at,
          tr.trial_status, tr.trial_ends_at,
          <EFFECTIVE_STATUS_SQL> as computed
     from feed_subscriptions s
     left join feed_tiers ft on ft.id = s.feed_tier_id
     left join licenses l on l.id = s.license_id
     left join lateral (
       select ftt.trial_status, ftt.trial_ends_at
         from feed_tier_trials ftt
        where ftt.user_id = s.subscriber_user_id and ftt.tier_key = ft.tier_key
        order by (ftt.trial_status = 'active' and ftt.trial_ends_at > now()) desc nulls last,
                 ftt.trial_ends_at desc nulls last
        limit 1
     ) tr on true
    order by s.id
   ```

   That is the read marcus used for the 0086 dry-runs plus `now()` and the CASE's inputs. Why this
   shape (my read of `src/lib/feed-subscriptions.ts` :140-159 at 3102373, which this commit does not
   touch): the CASE is written against the aliases `s` and `ft`, so `feed_subscriptions s` +
   `left join feed_tiers ft` let it drop in unmodified; `left`, because a `provider_tier_id` row has
   no `feed_tiers` row and the CASE's first gate is `ft.region_key is null`. The two `l` aliases nest
   the other way round from what R12 wrote (corrected by fable m50501_mu124d6c strike 5): inside the
   CASE's own licence `exists` (:146) the inner `l` shadows this select's top-level `l`, not the
   reverse, which is how Postgres resolves an inner FROM item. The CASE is unaffected either way --
   that exact pairing is already shipped in the provider reader at :534-544. The lateral returns
   the trial row the CASE's `exists` would match when there is one and otherwise the nearest, so a
   row that FAILS the trial branch still shows why; both of its order keys carry `nulls last`
   (fable m50501_mu124d6c strike 5), because Postgres sorts NULLs FIRST under DESC, so a NULL
   `trial_ends_at` -- and the NULL the boolean first key takes with it -- would outrank the very
   trial row the CASE matches and the lateral would hand the paste the wrong row. `s.lapsed_at` is
   selected because step 4's cause (i) cannot otherwise tell `deactivateFeedTierSubscription`'s
   lapse from the file's (fable m50501_mu124d6c ruling C; the CAVEAT it replaces is struck below).
   The after-read (step 4) is this same select, so
   it carries its own `now()` too, and both instants are pasted: steps 3 and 4 compare results taken
   at two different clocks, and without the two instants the operator cannot tell a clock mover from
   a file mover (fable Z5, m50440_mu111ike).
3. Apply (`commit`). Paste every notice line. The two runs are NOT compared for equality: prod takes
   app writes at any instant, there is no maintenance mode, and there is one `NEON_DATABASE_URL`
   (marcus m50442_mu111sw2, VERIFIED by marcus, not by me), so an ordinary renewal, new subscription,
   admin deactivation or server registration between the two runs would stop a correct apply. The
   dry-run and the apply run the byte-identical file, so a difference between them can only come
   from the data or the clock, never from the file.

   Each run's notices are checked on their own against the four properties. TRANSCRIBED at R16, no
   longer carried by cite (fable m50501_mu124d6c strike 8: the bus keeps only the newest 2,000
   messages, about 2.7 days, so the cited message is evicted around 09-16/17, possibly before the
   apply). Source: fable m50436_mu110c5u, as revised in fable's R12 verdict (m50501_mu124d6c,
   2026-09-14 09:45Z), adopted by marcus m50442_mu111sw2; the words below are fable's, quoted from
   that verdict, and all four hold WITHIN ONE RUN:
   > 1. Every `step 4b candidate:` line has `server_registration_id` NULL and `computed=lapsed` (the
   >    refusal gate enforces the second).
   > 2. Every non-NULL `ends_at` on a `step 5 carve-out:` line is later than every `ends_at` on a
   >    `step 4b candidate:` line. The file's predicates put the run's `now()` between the two sets;
   >    the paste does not print it.
   > 3. `step 5 listed` = 4b candidates + carve-out + the NULL-server rows already stored lapsed
   >    (18 + 6 + 3 = 27 on marcus's 08:41Z read; the uncovered gate enforces it).
   > 4. jorgbuteijn and abdulkareem appear on no `step 4b` or `step 5` line. If either does, stop.
   > (Revised from m50436: 1 and 2 no longer need the run's `now()`, and 4 is scoped to the lines it
   > was about, because step 9 carry lines name requesters.)

   One correction to property 2's last clause, which was written without R14 in hand (R14 d7725f6
   landed after m50501 was sent): the paste DOES print the run's `now()` since R14, twice, per the
   two sites below. The property holds as stated either way -- it is checkable from the `ends_at`
   values alone -- and the printed instant is now a second, independent check on it.

   Across the two runs, one containment: every `step 4b candidate:` id in the apply is either a 4b
   candidate in the dry-run, or a dry-run `step 5 carve-out:` row whose `ends_at` falls between the
   two runs' `now()` (both instants are in the pastes since R14). Second reading of that same limb,
   which needs neither stamp (fable m50501_mu124d6c ruling A): the row carries the same id AND the
   same printed `ends_at` in both runs' notices. The dry-run carve-out predicate
   (`fs.ends_at > now() or fs.ends_at is null`, 0088:879) puts that `ends_at` after the dry-run's
   `now()`, and the apply's 4b predicate (`fs.ends_at < now()`, 0088:745) puts it before the apply's,
   so the two notices prove the crossing on their own. A same id whose printed `ends_at` DIFFERS
   between the runs is not this limb: stop. (Grep B (iii) below: no app writer can change a
   NULL-server row's `ends_at` -- the one `ends_at` writer is the re-activation path, which selects
   on `server_registration_id = $1`.) If an apply 4b id is neither, stop: the file lapsed
   a row the dry-run review never showed. Any other difference is an app write between the runs: a
   new carve-out row, a row gone from the listing or from the 4b set, or a changed `ends_at` /
   `status` / `server_registration_id` on the same id. Name each one in the paste; none of them is a
   stop. (fable Z6, m50452_mu11gweq.)

   The second limb of the containment is the ordinary clock case: Aylrn's 3 rows move from
   `step 5 carve-out:` to `step 4b candidate:` if the two runs fall either side of 09-19 and
   rasoolx55's across 09-25, and the step 4b / step 5 counts move with them (fable Z5,
   m50440_mu111ike, on the ends_at dates in marcus's 08:41Z read m50350_mu0ztzip).

   Where each run's `now()` is visible in the paste. AMENDED by R14 (marcus m50485_mu11vkq7,
   2026-09-14): in two places, and they are different jobs.
   - `run now()=<instant>` (0088:177), the first notice of the run, before the step-0 ledger checks,
     so a run that aborts still stamps itself.
   - `run_now`, the first column of the step 10 summary row (0088:1284), so that the instant and the
     counts it dates arrive in the same message when the paste is split.
   Both are `now()`, the function the predicates call, not `clock_timestamp()` and not a literal: a
   stamp the predicates could disagree with would be worth nothing. One transaction, one snapshot
   clock, so the two print the same instant, and the second also names WHICH run a paste is -- the
   dry-run and the apply execute byte-identical SQL and differ only by their clock and the data.

   Until R14 this value was in the paste NOWHERE, in either run (my read of
   `db/migrations/0088_tighten.sql` at 3102373), which is why it is recorded here: the properties in
   the list above and marcus's two dry-run properties are all stated relative to the run's `now()`,
   and an artefact that does not state that instant leaves the operator substituting a wall clock of
   their own -- a property that cannot be evaluated from the artefact is not a check (marcus, same
   message). No notice printed it -- the 4b candidate, 4b REFUSE, step 5 carve-out and step 5
   listing notices print each row's `ends_at`, never the transaction's clock -- and the summary row
   had no `now()` column. The ledger row does hold it, `schema_migrations.applied_at` defaulting to
   `now()` (0003:19), but the INSERT (0088:1308-1310) has no `returning`, so it is not pasted either,
   and after a dry-run it is rolled back and gone: the apply's `now()` was recoverable after commit
   with `select applied_at from schema_migrations where version = '0088'`, the dry-run's was not
   recoverable at all. The step-2 read's `read_at` on each side of each run brackets that run's
   `now()`, but it is a different statement on a different clock and is not a substitute for it.
   Standing step, from the same ruling (fable m50501_mu124d6c ruling A): after the apply commits,
   paste `select applied_at from schema_migrations where version = '0088'` for the record. That is
   the ledger's own stamp of the apply, independent of the two notices R14 added, and it is the only
   one of the three that survives the session.

   Same two sites in `0089_drop_server_or_lapsed_exception.sql` (:89 and :348). Marcus named the two
   0088 sites; the property that selects them is "a pasted run whose gates are evaluated against
   `now()`", and 0089's step 2, step 3 and step 4 gates all have it, so the file is in the set
   (m50424 -- a named list of sites is a floor, derive the predicate and grep). The two rollback
   files are NOT in it: neither has a `now()`-relative gate (`grep -c 'now()'`: `0088_rollback.sql` 1,
   a `default now()` on a temp-table DDL, `0089_rollback.sql` 0) and neither has a step 0 or a
   summary select to hang a stamp on. Whether they should gain one anyway, on the "which run is
   this" limb alone, is open for fable.
4. After-read = the step-2 select run again (it carries its own `read_at`). The two reads are NOT
   compared for equality either, and for the same reason as step 3. Every difference between them
   has one of three causes, and only a difference with none of them runs the rollback (fable Z6,
   m50452_mu11gweq):
   - **(F) The file.** Stored `status` -> `lapsed` on every id named in this run's
     `step 4b candidate:` / `step 2b(b)` lines, with `computed` unchanged; plus each other file
     write that grep A lists, on the ids its notice names. If a listed id is not stored-lapsed in
     the after-read: rollback.
   - **(C) The clock.** `computed` live -> lapsed where `l.expires_at` or the trial end falls
     between the two `read_at`. Those two are the CASE's only clocks, and step 2 now selects both
     so the operator can check this without a second query. NOT `fs.ends_at`: the CASE never reads
     it (`src/lib/feed-subscriptions.ts` :140-159, my read at 3102373). `fs.ends_at` moves 0088's
     sets in step 3, and never `computed` (fable Z6 fix 1, m50452_mu11gweq, correcting fable's own
     Z5 text).
   - **(A) The app.** A new or missing id; a changed column that the file does not write (per grep
     A); any `computed` move that follows from one of those; a stored lapse by a grep-B writer,
     told apart from (F) as B(i) says. Name each one in the paste.

   Anything else, above all a stored -> `lapsed` on an id that no notice names and no (A) writer
   explains: the file is wrong, and the rollback runs.

   The live case for (C), from marcus m50417_mu10scek as relayed in fable m50440_mu111ike and NOT
   my read: abdulkareem.almansoori's rows and licence end at 2026-09-14T09:01:12.638Z; that account
   has a server row, so it is in neither the 4b candidates nor the carve-out, and a before-read
   before that instant with an after-read after it moves its `computed` with nothing in the file
   touching it. It moves through its licence's `expires_at`, which is what the CASE reads.

   Under (F), the expected movers are NOT named ahead from the before-read: they are the
   `step 4b candidate:` lines of THE SAME RUN's notice paste, plus any `step 2b(b)` lines (fable Z2,
   m50391_mu10l45h). The before-read is a different `now()`, so a row whose `ends_at` falls between
   the two is a real mover it does not list -- Aylrn's 3 rows cross on 09-19 and would do exactly
   that mid-run. The gap this paragraph used to state is CLOSED by R14 (marcus m50485_mu11vkq7,
   2026-09-14, applying fable's Z2 principle -- name every row the step is about to touch, not only
   the ones it refuses): 2b(b) now prints `step 2b(b) candidate: id=% status=%
   server_registration_id=% ends_at=%` once per staged id BEFORE its gate (0088:472), the same four
   columns and the same order as its refusal notice (0088:494) and the same shape as
   `step 4b candidate:`. Before R14 the success path printed counts only
   (`step 2b(b) ok: staged=% lapsed_by_word=%`, 0088:507), so a non-empty slot's ids were readable
   only from the file's own `tmp_0088_lapse_by_word` literals -- a read of the file, not of the run,
   and 2b(b) is the one block that acts on a human word rather than on a predicate, which is where
   an unnamed row is least defensible. The loop costs nothing on today's empty slot (staged=0, no
   lines) and is the whole record on the run where the slot is used. A staged id with no
   `feed_subscriptions` row prints NULLs here and then aborts at the gate.

   AMENDED by R9: fable's S4 caveat -- a row whose `ends_at` is past but which still computes live
   (trial licence, renewed licence, ungated region, `cme`) and would therefore be a COMPUTED mover
   when lapsed -- is no longer left to the population being lucky. Step 4b's refusal gate re-takes
   that check inside the transaction and aborts naming each such row, so "computed unchanged" is
   enforced by the file on every row it touches, not just expected of it (causes (C) and (A) are
   about rows it does not touch). Marcus's read of 2026-09-14 08:41Z has 0 such rows in the 21 (so 0
   in the 18 the Z1 conjunct leaves).
5. Schema reads: `information_schema.columns` for `feed_subscriptions` (fable Q2's SELECT,
   section 11) has no `request_id` row and has `lapsed_at`; `to_regclass('feed_tier_requests')
   is null`; `pg_indexes` has neither `feed_subscriptions_request_tier_uidx` nor
   `feed_subscriptions_license_feed_tier_live_uidx`; `pg_constraint` HAS
   `feed_subscriptions_server_or_lapsed_chk` (contype 'c'), HAS
   `server_registrations_license_owner_fkey` with `confdeltype = 'n'` and a two-column `conkey`
   (fable S1), HAS `licenses_id_user_id_key` (contype 'u'), and the 0031 single-column FK is
   gone; `server_registrations.user_id` is `is_nullable = 'NO'`; `'0088'` in `schema_migrations`.
6. Allowlist read: `select server_registration_id, feed_tier_id, ip, told_at from
   feed_allowlist_records where told_at < '2026-09-12T22:58:19Z' order by told_at` (the phase-2
   deploy instant, S3, fable m49281_mtz1czu5; same literal as section 4, under the same ruled
   comment: `Vercel deployment dpl_6SggmsWv7raHRi7vHUu6k6C33rfV ready 2026-09-12T22:58:19Z,
   meta.githubCommitSha=3ded80d, read by leo m49262`) = the carry list from section 5, row for
   row, PLUS the step-2b(c) rows if any literal is present (fable T6); count = summary
   `allowlist_carried + allowlist_carried_by_word`; `select count(*) ... where revoked_at is null`
   = summary `allowlist_open_total`.
7. App smoke after apply, before the cleanup deploy: Request Access on a registered server and an
   admin approval both succeed (the window query still runs, now against no index: plain SELECT);
   the admin queue and the provider Overview render; `/feed/dashboard/subscribers` renders the same
   rows as before apply (no reader of the dropped objects).
8. After the cleanup deploy: repeat 7; the duplicate-grant refusal still fires on a second approval
   of the same (server, tier) (`DuplicateTierGrantError` from the new-key query alone).
9. No UI check: section 6 is permission only (fable Q5); nothing on `/feed/dashboard` changes in
   this job.

**The two write sets step 4 attributes against (fable Z6, m50452_mu11gweq; marcus asked for B inside
it). Both are my own reads at 3102373, which touches no SQL and no `src`.**

**Grep A -- what the FILE writes.**
`grep -niE '(update|insert into|delete from)[[:space:]]+(feed_subscriptions|licenses|feed_tier_trials|server_registrations)' db/migrations/0088_tighten.sql`
-> 7 hits. No `insert into` and no `delete from` among them: the file only UPDATEs these four
tables, and it never writes `licenses` or `feed_tier_trials` at all.

Line numbers below are RE-TAKEN at R14, which inserted lines into this file; the hit set and the
SET columns are unchanged from the 3102373 reading, only the numbers and the 2b(b) verdict moved.

| line | table | SET columns | per-row notice naming its rows |
| --- | --- | --- | --- |
| 194 | server_registrations | `user_id` (from `licenses.user_id`; `updated_at` deliberately untouched) | NO -- `step 1 ok: ... null=0 owner_mismatch=0 ...` (:241) is counts. Per-row `step 1 owner mismatch:` (:235) fires only on the abort path. Expected UPDATE 0. |
| 361 | feed_subscriptions | `access_request_id` | NO -- `step 2 gate ok: ... with request_id=% unmapped=0` (:381) is counts. Expected UPDATE 0. |
| 500 | feed_subscriptions | `status='lapsed'`, `lapsed_at=now()`, `updated_at=now()` (2b(b), worded slot) | YES since R14 -- `step 2b(b) candidate:` (:472) prints one line per staged id BEFORE the gate. `step 2b(b) ok: staged=% lapsed_by_word=%` (:507) is still counts and `step 2b(b) not a live no-server row:` (:494) still fires only on the abort path. Slot EMPTY by default (staged=0, no candidate lines). |
| 597 | feed_subscriptions | `server_registration_id`, `updated_at=now()` | NO -- `step 4 ok: ... null rows=%` (:616) is counts. Expected UPDATE 0. |
| 619 | feed_subscriptions | `ends_at` (= `licenses.expires_at`), `updated_at=now()` | NO -- `step 4 gate ok:` (:649) is counts. Expected UPDATE 0. |
| 626 | feed_subscriptions | `ends_at` (= `feed_tier_trials.trial_ends_at`), `updated_at=now()` | NO -- same notice. Expected UPDATE 0. |
| 809 | feed_subscriptions | `status='lapsed'`, `lapsed_at=coalesce(lapsed_at, ends_at)`, `updated_at=now()` (4b predicate lapse) | YES -- `step 4b candidate:` (:783) prints one line per candidate BEFORE the gate, and the lapse is restricted to that gated set by id. |

AMENDED by R14: two of the seven writes now name their rows in the paste -- the 4b lapse and the
2b(b) worded lapse -- and they are exactly the two that are designed to move rows. The other five
are expected to move 0 rows, and if any of them moves a row it is a finding in its own right. Before
R14 only the 4b lapse named its rows; 2b(b) moved rows without naming them, which was stated here
for a ruling and ruled by marcus m50485_mu11vkq7.

ADDED at R16 (fable m50501_mu124d6c strike 4): **the five expected-0 writes print a command tag, and
the tags are part of the paste.** 0088:194, :361, :597, :619 and :626 are top-level statements --
each sits in a gap between an `end $$;` and the next `do $$` (my read of the block boundaries at this
commit: 186/205, 355/369, 590/603, 617/635) -- so they are outside every DO block and psql prints
`UPDATE n` for each. Steps 1 and 3 therefore paste psql's command tags as well as the notices: the
run is NOT made with `psql -q`. A dry-run `n != 0` on any of the five: stop before the apply and take
it to the thread, because the file's own expectation (`Expected: UPDATE 0` at 0088:192 and :360,
`Expected: UPDATE 0 / 0 / 0` at :596) is then wrong and the cause has to be found first. An apply
`n != 0` on one of them: named in the paste, not a rollback. None of the five writes `status` or
`lapsed_at` -- the SET columns are in the table above -- so none of them can do the one-way harm the
rollback exists for.

**Grep B -- what the APP writes.** `git grep -nEi '<the same regex>' -- src` -> 29 hits in 24
functions across 8 files (feed_subscriptions 6/5, licenses 13/11, feed_tier_trials 5/5,
server_registrations 5/3), plus my
checks for the two shapes the regex would miss: a line-wrapped `insert into` / `delete from`
(0 hits in `src`) and a delete on any of the four tables (0 hits in `src`; the only ones in the repo
are `db/migrations/0081_rollback.sql:25` and `scripts/seed_multi_license_test_user.sql:25`). So the
app never deletes from these four tables.

ADDED at R16, the third shape the first regex would miss -- a schema-qualified or double-quoted table
name -- run together with the one function name the `EFFECTIVE_STATUS_SQL` comment calls a
`feed_subscriptions` writer (fable m50501_mu124d6c strike 9):
`git grep -nEi 'upsertFeedSubscriptionForRequest|public\.(feed_subscriptions|licenses|feed_tier_trials|server_registrations)|"(feed_subscriptions|licenses|feed_tier_trials|server_registrations)"' -- src`
-> 16 hits at this commit, no live writer among them, so grep B misses no writer through either
shape. `public.` qualification: 0 hits anywhere in `src`. `upsertFeedSubscriptionForRequest`: 4 hits,
every one a comment line (`src/lib/feed-subscriptions.ts` :40, :117, :1296, :1316), and :1296 is the
doc comment of the function that REPLACED it ("the approval-path write (formerly
upsertFeedSubscriptionForRequest here"), so the name has no definition and no call site left in
`src`. The other 12 are the quoted literal `"licenses"` passed to `licenseNumberSql` /
`licenseStatusCaseSql` at `src/lib/licenses.ts` :153, :227, :570, :588, :609, :762, :937, :971,
:1117, :1118 -- :153 and :227 are the `returning` clauses of the two INSERTs grep B already lists
(`issueLicense` :151, `issueAdditionalLicense` :225) and the other eight are SELECTs -- plus two
sidebar/topbar route labels (`src/components/portal/sidebar.tsx:81`, `topbar.tsx:13`).

`feed_subscriptions` (6 hits / 5 functions):

| line | function | columns |
| --- | --- | --- |
| `access-requests.ts:326` | `approveOnClient` (feed_tier branch) | INSERT: provider_user_id, subscriber_user_id, license_id, server_registration_id, feed_tier_id, `status='active'`, access_request_id, ends_at |
| `feed-subscriptions.ts:329` | `createSubscription` | INSERT: same column list plus provider_tier_id |
| `feed-subscriptions.ts:1386` | `assignFeedTierSubscription` (re-activate) | `status='active'`, `lapsed_at=null`, `ends_at`, `updated_at` |
| `feed-subscriptions.ts:1395` | `assignFeedTierSubscription` (re-activate, provider changed) | `provider_user_id`, `status='active'`, `lapsed_at=null`, `ends_at`, `updated_at` |
| `feed-subscriptions.ts:1461` | `deactivateFeedTierSubscription` | `status='lapsed'`, `lapsed_at=now()`, `updated_at` |
| `feed-subscriptions.ts:1492` | `setFeedSubscriptionPriceForPackage` | `price_cents`, `updated_at` |

`licenses` (13 hits / 11 functions): `issueLicense` :151 and `issueAdditionalLicense` :225 (INSERT
user_id, license_key, status, expires_at, notes, feed_types, tier, and :151 also claim_email /
claim_telegram_user_id); `extendLicense` :372 (`expires_at`, `lifecycle_state`); `expireLicenseNow`
:379 (`expires_at=now()`, `lifecycle_state=null`); `revokeLicense` :394 and :404
(`status='revoked'`, `lifecycle_state`); `setLicenseTier` :438 (`tier`); `verifyLicenseKey` :659
(`last_verified_at`); `setLicenseFeedTypes` :1346 (`feed_types`); `claimPendingLicense` :1386 /
:1393 (`user_id`, `claim_email` / `claim_telegram_user_id`); `expire-licenses/route.ts:111` GET
(`lifecycle_state='expired_processed'`); `admin/users/actions.ts:70` `expireNowAction`
(`expires_at=now()`). Of these, the CASE reads only `status` and `expires_at`, so the computed
movers are `extendLicense`, `expireLicenseNow`, `expireNowAction` and `revokeLicense`. The
`lifecycle_state`-only cron at :111 moves nothing the CASE reads.

`feed_tier_trials` (5 hits / 5 functions): `insertFeedTierTrial` :130 (INSERT user_id, license_id, region,
tier_key, `trial_ends_at = now() + interval`; `trial_status` NOT written, so it takes the column
default `'active'`, 0036:20); `cancelFeedTierTrial` :241 (`trial_status='cancelled'`);
`markFeedTierTrialConverted` :255 (`trial_status='converted'`); `expire-trials/route.ts:36`
`sendReminders` (`reminder_sent_at`); `expire-trials/route.ts:68` `expireTrials`
(`trial_status='expired'`, `ended_notified_at`). All but `sendReminders` move the CASE's trial
branch -- and `insertFeedTierTrial` moves it UPWARDS, lapsed -> live, on an existing row.

`server_registrations` (5 hits / 3 functions): `saveServerRegistration` :195 / :211 (INSERT ... `on conflict
(license_id) do update`: license_id, user_id, server_name, vps_provider, vps_provider_other,
server_location, location, declared_ip, updated_at); `updateServerRegistrationById` :272 / :284
(same minus license_id and user_id, by row id + owner); `setMultipleIpsOk` :317 (`multiple_ips_ok`,
`updated_at`).

Z6's three questions:

- **(i) Does any of them write `status='lapsed'` to `feed_subscriptions`?** YES, exactly one:
  `deactivateFeedTierSubscription` (`feed-subscriptions.ts:1459-1469`), the admin's
  `deactivateFeedSubscriptionAction`, which the EFFECTIVE_STATUS_SQL comment at :111-112 already
  names as the one-way ratchet. How step 4 tells it apart from (F): by id and by `lapsed_at`. It is
  keyed on `(subscriber_user_id, tier_key)` and sets `lapsed_at = now()`, whereas 4b sets
  `lapsed_at = coalesce(lapsed_at, ends_at)` on exactly the ids its `step 4b candidate:` notices
  name. RULED by fable m50501_mu124d6c ruling C at R16, replacing the R12 caveat: a stored ->
  `lapsed` on an id that no notice names is (A) only if its `lapsed_at` falls STRICTLY BETWEEN the
  two `read_at` AND DIFFERS from that row's `ends_at`; otherwise the rollback runs. Both clauses are
  load-bearing, because 4b stamps `lapsed_at = coalesce(lapsed_at, ends_at)` (0088:809) and a row
  that crosses mid-window has its own `ends_at` inside that window too -- the time test alone would
  read the file's own lapse as an app write. The caveat this replaces (the step-2 select did not
  carry `lapsed_at`) is closed by the same ruling: `s.lapsed_at` is now a column of that select,
  section 9 step 2, so both clauses are checkable from the two pastes and no operator has to run a
  third query. No SQL touched here either way -- the step-2 select is this document's text, not the
  migration's.
- **(ii) Can any of them leave a non-lapsed `feed_subscriptions` row with `server_registration_id`
  NULL?** NO, on all three routes.
  - Insert: both inserts write the column, and neither can pass NULL --
    `CreateSubscriptionInput.serverRegistrationId` is typed `string` (not `string | null`,
    `feed-subscriptions.ts:47`) and its one caller passes the locked `sr.id`; `approveOnClient`
    passes `sr.id` from `lockServerRegistration` and throws if the server row is gone
    (`access-requests.ts:312-313`).
  - Re-activation: :1386 / :1395 update a row selected by `where server_registration_id = $1 and
    feed_tier_id = $2` (:1376), which a NULL-server row can never match, and neither statement
    writes the column. So the re-activation path cannot lift a NULL-server row to `active`.
  - Through the FK: the app has no delete on `server_registrations` (0 hits above), and the
    pre-apply FK carries NO `on delete` clause -- `server_registration_id uuid references
    server_registrations(id)`, `0086_marketplace_recut.sql:576` -- so its action is the default NO
    ACTION. A delete of a referenced server row raises 23503; it never NULLs the child column.
  - No `update ... set server_registration_id` exists anywhere in `src` (0 hits).
  And the FK route stays shut AFTER the commit, not only before it (fable m50501_mu124d6c strike 7):
  0088 never touches the `feed_subscriptions.server_registration_id -> server_registrations` FK at
  all. Its only FK work is on `server_registrations` -- drop the unnamed 0031 single-column FK by
  lookup (0088:1076) and add `server_registrations (license_id, user_id) -> licenses (id, user_id)
  on delete set null (license_id)` (0088:1088-1091); those four lines are the complete output of my
  `foreign key|references|add constraint|drop constraint` grep over the file at this commit, outside
  the header comment. So `0086_marketplace_recut.sql:576`'s NO ACTION is the post-apply action too,
  and the user-delete cascade into `server_registrations` (section 8 S1(ii), T4) meets NO ACTION and
  raises 23503; it never SET NULLs the child column.
  So the list marcus wants for the post-commit 23514 risk is EMPTY, before the commit and after it:
  after the CHECK lands, no app path can produce a non-lapsed NULL-server row, and the carve-out ids
  being fixed at apply costs nothing until the B-1 guard.
- **(iii) Can any of them change `fs.ends_at` or `fs.server_registration_id` on an existing row?**
  `ends_at`: YES -- `assignFeedTierSubscription` :1386 / :1395 write `ends_at = license.expiresAt`
  when re-activating an existing row. That is an (A) difference in step 4 and, per step 3, a
  legitimate cross-run change in `ends_at` that can also move a row between the 4b set and the
  carve-out. `server_registration_id`: NO -- no app statement writes it after the insert.

Rollback of the schema is `0088_rollback.sql` (section 4). Rollback of the cleanup commit is a
code revert; it re-adds a SELECT against a column that still exists, so it is safe in either
order.

---

## 10. Section-11 items carried from 0086-phase2-code.md

- Item 2 (Source B, "every `server_registrations` writer writes `user_id`", ruled Leo's): landed on
  main in Leo's `saveServerRegistration` (:180, :186 write `user_id`; my read at 9e84f16). This
  file re-runs the section 1 backfill as the header's safety net and then declares NOT NULL (step
  1, step 7). Carried as: DONE by Leo, ENFORCED here.
- Item 4 (Source G(d), the `'provisioned'` carry, ruled tighten's): section 5. Carried as: THIS
  FILE, step 9.
- Item 1 (renewal write) and item 3 (trial clock after-commit gap): not this file, unchanged.
- 0086 spec section 9 bookkeeping line (P2): the second live check "drops with the tighten": section
  8, the cleanup commit.

---

## 11. Open questions for fable, and the prod reads marcus runs

**For fable: Q1-Q7 RULED in m49199 (23:23Z), folded in above; nothing open.** Where each landed:
Q1 one file (section 2 note). Q2 `coalesce(lapsed_at, ends_at)` for expiry lapses, `now()` for
worded lapses (step 5, step 2b). Q3 `told_by` not added (section 5). Q4 approved-only rows: no
default carry, literal in 2b(c) on coxwell's word (section 5). Q5 permission only (section 6).
Q6 window rule split (section 7, section 8). Q7 verbatim quotes (sections 6, 7). Q8 of 6f2ada9
is DROPPED with R3 (marcus m49385 item 2). Closed in fable's hunk read (m49478/m49479): the
constraint name `server_registrations_license_owner_fkey` ACCEPTED; the `is distinct from` operator
confirmed in fable's own words (m49231_mtz0pepn, quoted in step 1).

**S3 APPLY GATES (fable T1, m49281_mtz1czu5 + m49294_mtz1gg15; load-bearing note m49310_mtz1l22g),
verbatim, both expect 0, both APPLY GATES not proofs; re-taken before the dry-run and before
apply, pasted with timestamps (section 9):**
```
select count(*) from feed_tier_requests where actioned_at >= '2026-09-12T22:58:19Z';  -- (1) closes the alias window; a legacy row actioned after the literal would sit above the rollback bound (section 4)
select count(*) from access_requests ar join feed_tier_request_details d on d.request_id = ar.id where ar.created_at < '2026-09-12T22:58:19Z' and ar.legacy_feed_tier_request_id is null;  -- (2) no new-path row below the literal
```
Read (2)'s `legacy_feed_tier_request_id is null` conjunct is REQUIRED: 0086 copied legacy
`created_at` into the 16 envelopes, and without it the read returns 16 and aborts a correct apply
(fable m49294). Read (2) is LOAD-BEARING (fable m49310): `NEON_DATABASE_URL` is one Vercel row
scoped preview+production (Leo, relayed m49305; not my read), so any preview build can write a
new-path row below the literal. Nonzero on either = do not apply; the remedy is a ruling, never a
pad. Exhaustiveness grep beside line one, my run at the branch working tree (src = 9e84f16),
`git grep -n legacy_feed_tier_request_id -- src`, 6 lines, zero INSERT/UPDATE hits:
```
src/lib/access-requests.ts:24: * legacy_feed_tier_request_id, or touches the read side (EFFECTIVE_STATUS_SQL, section 8). */
src/lib/access-requests.ts:492:  legacy_feed_tier_request_id: string | null;
src/lib/access-requests.ts:513:         a.invoice_ref, a.reason, a.decided_by, a.decided_at, a.legacy_feed_tier_request_id,
src/lib/access-requests.ts:541:    legacyFeedTierRequestId: row.legacy_feed_tier_request_id,
src/lib/access-requests.ts:594: * feed_tier_requests.id; 0086 section 3 copied it onto legacy_feed_tier_request_id, as N
src/lib/access-requests.ts:600:    `${LIST_SQL} where a.id = $1 or a.legacy_feed_tier_request_id = $1 order by a.created_at desc, a.batch_id, ft.tier_key`,
```
(2 comments :24 :594; 1 type field :492; 2 SELECT-side :513 :600; 1 row mapper :541. No writer sets
the column, so only 0086 ever did, and read (2)'s conjunct is exact.)

**For marcus (read-only, prod, paste the outputs; none of these I can run):**
```
select count(*) from feed_tier_requests;                                            -- legacy_rows (m49188: 13, marcus's)
select status, count(*) from feed_tier_requests group by status order by status;    -- incl. provisioned_to_map, approved-only (m49188: approved 8 / pending 5 / provisioned 0 / rejected 0)
select count(*) from feed_subscriptions where request_id is not null;               -- with_request (m49188: 6)
select count(*) from feed_subscriptions where request_id is not null and access_request_id is null;  -- must be 0 (m49188: 0)
select count(*) from server_registrations where user_id is null;                    -- must be 0 (m49188: 0)
select count(*) from server_registrations sr join licenses l on l.id = sr.license_id where sr.user_id is distinct from l.user_id;  -- S1 owner gate, must be 0 (EXPECTED 0: marcus 23:37Z NULL-safe read, m49385 (B))
select count(*) from licenses l where l.user_id is null and exists (select 1 from server_registrations sr where sr.license_id = l.id);  -- S1 NULL-owner licences with server rows, must be 0 (EXPECTED 0: same read)
show server_version;                                                                -- S1: composite FK set null (license_id) needs >= 15; known 17.11 (marcus m49219 item 1, via fable m49479), this is the re-confirm
select column_name, is_nullable from information_schema.columns where table_name = 'feed_subscriptions' order by ordinal_position;  -- fable Q2: proves lapsed_at present, request_id present before / absent after
select count(*) from feed_subscriptions where server_registration_id is null;       -- fs_no_server (m49188: 27 = 6 live + 18 lapse-able + 3 stored-lapsed)
select count(*) from feed_subscriptions where server_registration_id is null and status <> 'lapsed' and (ends_at > now() or ends_at is null);  -- step-5 BLOCK count, S4 predicate (m49188 under the v1 predicate: 6; re-run under S4)
select count(*) from feed_subscriptions where server_registration_id is null and status <> 'lapsed' and ends_at <= now();  -- step-5 lapse count, S4 predicate (m49188 under v1: 18)
select id, subscriber_user_id, feed_tier_id, status, ends_at from feed_subscriptions where server_registration_id is null and status <> 'lapsed' and (ends_at > now() or ends_at is null) order by subscriber_user_id, feed_tier_id;  -- step-5 population by name (the rows coxwell resolves via 2b(b))
select count(*) from feed_allowlist_records;                                        -- new-path records so far (m49188: 0)
select conname, confdeltype from pg_constraint where conrelid = 'server_registrations'::regclass and contype = 'f';  -- (m49188: both CASCADE)
select count(*) from pg_constraint where confrelid = 'feed_tier_requests'::regclass;  -- expect 1 (the 0078 FK) (m49188: 1)
select count(*) from feed_tier_requests where status = 'provisioned' and actioned_at is null;  -- guard (b), must be 0
```
plus the two listings: section 3 step 3 (no-envelope rows) and section 5 (the carry SELECT;
m49188: 0 rows, so Q4's 8 approved rows are the material list for coxwell). The m49188 figures
are marcus's 23:22Z reads (relayed here as expected values, not mine); the two S1 zeros are
marcus's 23:37Z read in m49385 (B).

Nothing in this document has been run against prod by kai. No file other than this one exists on
the branch.

---

## 12. Rulings ledger -- HISTORY, plus the live rulings R2 (0088 filename), R9 (predicate lapse, refusal gate, computed carve-out) R10 (Z1 narrows the lapse to NULL-server rows; Z2 candidate notices; Z4 rollback text) R14 (the run's now() printed twice; 2b(b) names its staged rows), R15 (TEXT only: no unsourced pronoun for a person) and R16 (TEXT only: fable's R12 verdict -- lapsed_at in the step-2 select, the four properties transcribed, command tags, nulls last). R4 / R5 / R6 / R8 were the exempt-six line and are SUPERSEDED by R9, kept as history.

**R9 (LIVE, supersedes R4 / R5 / R6 / R8 on everything about the six) -- the lapse becomes a
predicate step with a refusal gate; the carve-out is computed, never written down.** Marcus
m50350_mu0ztzip (2026-09-14 08:41Z), on a marcus prod read of my Q4 SQL plus a display-name column.

What that read returned: 21 rows, `status <> 'lapsed' and ends_at < now()`, `effective_status =
'lapsed'` on every one, 7 clients, all `london`, all `ld-beta-56` / `ld-gamma-19` / `ld-delta-18`.
No renewed-in-place licence, no ungated / `cme` row, no `region_key is null` row: my two hazard
cases are real in the code and absent from the data. MARCUS'S read, not mine (rule 8).

Two populations that must not be merged, the m50350 table verbatim in effect:

| predicate | rows | clients |
|---|---|---|
| `status <> 'lapsed' and server_registration_id is null` (the tighten blocker) | 24 | 8 |
| `status <> 'lapsed' and ends_at < now()` (the lapse step) | 21 | 7 |

One client (3 rows) is past `ends_at` but HAS a server registration -- in the lapse set, invisible
to step 5. Two clients (6 rows) have no server but are still current -- in the blocker set, not in
the lapse set. Expected state after 4b: 6 no-server live rows, 2 clients (to 09-19 and to 09-25).
"Use it as a CHECK, never as a hardcoded list": the 6 becomes 3 on the 19th and 0 after the 25th.

The four rulings:
1. **Predicate lapse step**, `ends_at < now()`, over every row. New spec step 4b; leaves step 5.
   **AMENDED by Z1 below (marcus m50396_mu10majx, the same day): the predicate gains
   `and server_registration_id is null`, so it is NOT over every row and the expected count is
   18 rows / 6 clients, not 21 / 7.** Read ruling 1 only together with Z1.
2. **The six hardcoded uuids are ripped out of all four lists** (0088 `tmp_0088_exempt`, 0088's
   CHECK, 0089 `tmp_0089_exempt`, 0089 rollback's CHECK) **and out of the step-5 gate.** Required
   regardless of the rest: the population marcus read on 09-13 14:55Z is not the population of the
   09-14 08:41Z read, and R6's committed list would have aborted step 5's SUBSET gate on apply.
   That is the concrete instance of the failure R9's gate exists to prevent.
3. **NULL-server carve-out gated on `ends_at > now()`**, computed in step 5 and materialised into
   the constraint text; 0089 re-arms by reading that text back instead of carrying its own copy.
   The exception stays keyed by id: a predicate exception in the constraint would admit every
   future NULL-server row.
4. **The refusal gate is ADOPTED** -- my own addition, prompted: "a gate that raises if any row it
   is about to lapse currently computes non-lapsed under the CASE above." Marcus's reason for
   wanting it while the set is empty: "my read proves the file is safe now. It says nothing about
   the day it actually gets applied... A migration that re-checks its own precondition cannot be
   overtaken by time; one that relies on my having checked can." Built in 0088 step 4b and in 0089
   step 3, both transcribing `EFFECTIVE_STATUS_SQL` (`src/lib/feed-subscriptions.ts:140-159`, blob
   `94fa705`) with the file, blob and line cited in the comment.

Scope: medium, unchanged -- Q4 came back clean, so there is no per-client access decision in this.

Applied at this commit: 0088 header + steps 2b / 4b / 5 / 6 / 10, 0088_rollback comments, 0089
header + steps 0-4 + summary, 0089_rollback section 4, and this document (sections 2 table row 6,
4b, 5, 6, 12).

**R10 (LIVE, amends R9) -- Z1 narrows the 4b predicate to NULL-server rows; Z2 names every
candidate in the paste; Z4 states the 0089 rollback's empty carve-out as construction, not luck.**
Fable's R9 read m50391_mu10l45h (2026-09-14 09:02Z, PASS-WITH-STRIKES Z1-Z4) and marcus's ruling
m50396_mu10majx (09:03Z). Z3 was answered separately as m50397_mu10mcpp (the raw
`EFFECTIVE_STATUS_SQL` source lines) and needed no file change.

**Z1 -- RULED (a), the conjunct is added; expected count 18 rows / 6 clients.** R9's predicate
`status <> 'lapsed' and ends_at < now()` selected population (b) of R9's own table, which is not
the population coxwell ruled on: one client's 3 rows are past `ends_at` but HAVE a server
registration, so they were never in the no-server blocker table coxwell was shown. "One" is the count
in marcus's 08:41Z read (m50350_mu0ztzip); a second client crossed `ends_at` at 09:01:12Z (marcus
m50417_mu10scek as relayed by fable m50440_mu111ike, not my read), so a reader at apply time finds
two, and
the `server_registration_id is null` conjunct excludes both and any later one (fable W1). Marcus's three
reasons, in that order of weight: (1) "it exceeds the authorisation" -- "his rows were about to be
lapsed on a ruling that never mentioned him"; (2) it buys nothing -- the lapse exists to unblock
the CHECK, "and the CHECK only cares about no-server rows... a step that alters client records
without advancing its own purpose should not run"; (3) fable's renewal point -- a stored `lapsed`
matches the read CASE's first branch, so on a renewed-in-place licence the rows would stay lapsed
until an admin re-grant, where today they would read live again. Marcus's rule for the future: "a
literal can under-reach; a predicate can over-reach. Neither is safe by category -- the test is
whether the set it selects is the set that was authorised." The refusal gate is unchanged; it now
runs over the 18. Text follows in 0088 header 4b, the step-4b comment, step 5's listing comment,
0088_rollback's not-reverted note, and this document (4b, section 9 step 4, R9 ruling 1).

**Z2 -- BUILT.** 4b raises one `step 4b candidate:` notice per candidate BEFORE the gate (id,
subscriber, tier, `server_registration_id`, `ends_at`, computed status, reason), so the run names
every row it is about to touch and not only the refused ones. Section 9 step 4 is corrected with
it: the expected movers are those lines from THE SAME RUN's paste plus any 2b(b) lines, NOT rows
named ahead from the before-read -- the before-read is a different `now()`, and Aylrn's 3 rows
cross on 09-19, mid-run.

**Z4 -- TEXT.** 0089_rollback's header and step-4 comment now say the recomputed carve-out is
EMPTY BY CONSTRUCTION after a committed 0089: the exception-less CHECK 0089 leaves is in force
until the rollback's own DROP in the same transaction, so no non-lapsed NULL-server row can exist
to be found. The carrying branch is kept as a GUARD against the constraint not having been in
force, not described as "non-empty only if new NULL-server rows appeared".

**Z5 (SUPERSEDED in part by R12, kept as the record of 3102373) -- TEXT, in a later commit;
fable's own correction of fable's Z2 text, NOT a marcus ruling (m50440_mu111ike, 2026-09-14
09:14Z, fable's R10 read: Z1/Z2/Z4 PASS).** Z2 fixed only the
stored-status half of section 9 step 4; steps 3 and 4 still compared two results taken at two
different `now()`s, so the clock alone could send a correct run to rollback. Section 9 step 2 now
selects `now()` in both reads; step 3 allows exactly one difference from the dry-run paste (a row
whose `ends_at` falls between the two runs' `now()` moves from `step 5 carve-out:` to `step 4b
candidate:`, counts with it); step 4 allows exactly one computed mover (live -> lapsed where the
row's own `ends_at`, or the licence or trial end the CASE reads, falls between the two reads'
`now()`). Also fable's W1, taken: the "one client with a server row" count in R10 Z1 above is
dated to marcus's 08:41Z read, with the second crossing at 09:01:12Z named. The same count in the
0088 header 4b (:79-80 at R15) and the step-4b population comment (:659-662 at R15) is already
dated to the 08:41Z read (m50350) and needed nothing for W1; section 3's 4b already dates it too. Three mis-citations of "section 11 step 4" for
section 9 step 4 (R10 Z1, R10 Z2, R10 applied-list) are corrected here -- they are what sent
fable's read to section 11. No SQL changes; marcus's dry-run does not wait on this.
Applied at this commit: this document only (section 9 steps 2-4, section 12 R10 Z1 + Z2 +
applied-list + this entry).

**Z6 -- TEXT (R12); the app writes during the window. fable m50452_mu11gweq, carrying marcus
m50442_mu111sw2, who VERIFIED prod takes app writes at any instant, has no maintenance mode, and
has one `NEON_DATABASE_URL`; marcus dispatched nothing on it.** Z5 left section 9 steps 3 and 4
comparing two instants for EQUALITY ("any other difference: stop"; "plus EXACTLY ... any
stored-status mover outside that list"), so an ordinary renewal, new subscription, admin
deactivation or server registration between the two reads would have stopped a correct apply. Both
equalities are struck. Step 3 now checks each run's notices on their own against the four
properties (fable m50436_mu110c5u, adopted by marcus m50442 -- carried here by cite only, since I
have not read m50436) and compares the two runs by ONE containment: an apply `step 4b candidate:`
id must be a dry-run 4b candidate or a dry-run carve-out row whose `ends_at` fell between the two
runs' `now()`; everything else is an app write, named in the paste, not a stop. Step 4 replaces its
equality with attribution to three causes -- (F) the file, (C) the clock, (A) the app -- and runs
the rollback only for a difference with none of them. Also in this commit, fable's three R11 fixes:
(1) step 4's clock exception drops `fs.ends_at`, because `EFFECTIVE_STATUS_SQL` never reads it (my
read, `src/lib/feed-subscriptions.ts` :140-159) -- its only clocks are `licenses.expires_at` beside
`l.status` and `feed_tier_trials.trial_ends_at` beside `trial_status`; (2) the step-2 select now
returns those inputs (`l.status`, `l.expires_at`, and the trial status and end the CASE's trial
branch reads for the row, via a lateral on subscriber + `tier_key`), so (C) is checkable from the
paste; (3) the live case under (C) in section 9 step 4 is introduced as "The live case", with no
possessive pronoun for fable (carried spec-wide by R13 below). Greps A (the file's write set) and B
(the app's writers, with Z6's three questions answered) are recorded in section 9 after the
numbered list.
What this commit replaces in the Z5 entry above, which stays as the record of 3102373, in two
points (fable m50468_mu11qveq item 5): (a) Z5's step-4 clock, "the row's own `ends_at`", was
fable's error -- `EFFECTIVE_STATUS_SQL` reads only `licenses.expires_at` and the trial end (fix 1
above, my read of :140-159); (b) Z5's step-3 "exactly one difference" and step-4 "exactly one
computed mover" are replaced by Z6: containment on the 4b candidate set in step 3, and
file / clock / app attribution in step 4.
Three things are stated for a ruling rather than papered over: each run's `now()` is visible NOWHERE
in the paste (the apply's is recoverable post-commit from `schema_migrations.applied_at`, the
dry-run's is not recoverable at all); 2b(b) has no per-row notice on its success path, so its ids
are readable only from the file's own literals; and telling `deactivateFeedTierSubscription` apart
from the file's lapse by `lapsed_at` needs `lapsed_at` added to the step-2 select, which is not
there today. No SQL changes: the dry-run target is fixed, and the file is unchanged since d172be2.
Applied at this commit: this document only (section 9 steps 2-4 + the new grep A / grep B block,
section 12 this entry).

**Z7 -- TEXT (R13); no pronoun for fable anywhere in the document, the Z5 entry headed as
history, and one full message id. fable m50468_mu11qveq (2026-09-14 09:34Z, fable's read of the
R11 tail: R11 PASSES as the record of 3102373), items 4 and 5.** R12 (ac67c34) crossed with that
message and carries fixes 1-3, Z6 and greps A/B already; items 4 and 5 are this commit.
Item 4: fix 3 was one site, and the pronoun grep fable specified in m50468 (word-matched,
case-insensitive, the two feminine third-person-singular forms) returned 41 lines over this
document at ac67c34. Every one of them is fable, and every one is now "fable" or "fable's" or the
sentence is reworded; the two clauses fable named in the Z5 entry, on that entry's Z2 text and on
the R10 read, are among them. The same grep at this commit returns nothing -- which is also why
neither the pattern nor any of the struck strings is quoted in this entry. Item 5: the Z5 entry keeps its clock text unchanged as the record of 3102373, headed
"(SUPERSEDED in part by R12, kept as the record of 3102373)" on the R8 pattern, and the Z6 entry
above gains the two points that say what replaced it. Also: "m50417" is written
`m50417_mu10scek` at both of its sites (section 9 step 4 and section 12 Z1, full id from
m50468; "as relayed by fable m50440_mu111ike, not my read" is unchanged, and I still cannot fetch
that id). One change NOT asked for, flagged to be struck if unwanted: the live case under (C) in
section 9 step 4 was my prose about a client account, carrying pronouns I had assigned to a real
person from no source; it now reads "that account ... it". Marcus's and coxwell's own pronouns,
which they use for themselves in this thread, are left alone. No SQL changes; the four SQL files
are unchanged since d172be2, and marcus's dry-run does not wait on this.
Applied at this commit: this document only, 86 insertions / 51 deletions, 35 hunks at -U0 -- status
block (:44-70), section 1 table row 2 (:92), section 2 (:190), section 3 (:236, :410, :450),
section 5 (:622, :628), section 6 (:647-654), section 7 (:702-727), section 8 (:755, :766),
section 9 step 4 (:910, :919-923), section 11 (:1098), and section 12 (Z1 :1219, Z5 head, Z6 two
points, R8, R6 addendum, R4 scope line, the R1/R3 history text, and this entry).

**R16 -- TEXT, no behaviour. fable's R12 verdict, applied on `adef2f0` and not on `ac67c34`.**
Source: fable m50501_mu124d6c (2026-09-14 09:45:09Z), fable's whole read of R12 `ac67c34`:
PASS-WITH-STRIKES, spec text only, rulings A-C on the three gaps R12 stated plus strikes 4-9.
SEQUENCING, stated first because it changes what the verdict asks for: m50501 was written before
R13, R14 and R15 existed and asks for "R13 = one commit on `ac67c34`". By then `e6e4ead` (R13),
`d7725f6` (R14) and `adef2f0` (R15) were on the branch, so this is R16 on `adef2f0`; rewinding to
`ac67c34` would drop marcus's two m50485 rulings. Two consequences for the verdict's own text: its
line anchors are `d172be2`'s and are RE-TAKEN here against this commit (`0088_tighten.sql` is 1312
lines now, not the 1274 of the paste whose md5 `4844a7c6...` marcus verified -- R14 and R15 both
moved it), and rulings A and B were reasoned from a file that did not yet print the run's `now()`.
Applied as asked: ruling C (`s.lapsed_at` joins the step-2 select; the R12 CAVEAT in grep B (i) is
replaced by the two-clause rule -- `lapsed_at` strictly inside the `read_at` window AND different
from the row's `ends_at`, because 4b stamps `coalesce(lapsed_at, ends_at)`); strike 4 (the five
expected-0 writes are top-level, psql prints their command tags, no `psql -q`, dry-run n != 0 stops
before the apply); strike 5 (`nulls last` on both lateral order keys, and the shadowing sentence
turned the right way round); strike 7 (the FK route is shut after the commit too, with the file's
complete FK work named); strike 8 (the four properties TRANSCRIBED into section 9 step 3 from the
verdict's revised text, cited as "fable m50436_mu110c5u, as revised in fable's R12 verdict", against
the 2,000-message bus window); strike 9 (the schema-qualified / quoted grep, 16 hits, run at this
commit -- `upsertFeedSubscriptionForRequest` is comment-only, so grep B missed no writer).
Already closed before this commit, no edit made: strike 6 -- the possessive R12 used for fable in the
(C) bullet of section 9 step 4 went at R13 and the whole class at R15, so the site now reads
"correcting fable's own Z5 text" and the struck string is not quoted here, on R13's rule that the
grep must stay clean over this document. Also closed: the m50468
leftovers -- item 4's pronoun grep (R13; re-run at this commit, 0 lines), item 5's Z5 head
"(SUPERSEDED in part by R12, kept as the record of 3102373)" with the Z6 entry naming what replaced
it (R13), and `m50417_mu10scek` at both sites (R13). The `grep -n 'section 11'` output goes to the
thread with this commit, raw.
NOT applied as written, both flagged for a strike rather than done quietly, both in ruling A. (a) A
replaces the containment's second limb ("`ends_at` between the two runs' `now()`") with an identity
on the printed `ends_at`, on the stated ground that the paste does not print each run's `now()`.
Since R14 it does (0088:177 and the step 10 summary at :1284, marcus m50485_mu11vkq7), so the limb
is checkable as it stood; both readings are now in the text, fable's added as the one that needs no
stamp, together with its new stop rule (same id, different printed `ends_at` -> stop). (b) A replaces
the last sentence of the facts paragraph; that sentence states why the step-2 `read_at` is not a
substitute for the run's `now()`, which is still true, so the `select applied_at from
schema_migrations where version = '0088'` step is ADDED after it instead of over it. One correction
carried in the same place: property 2's closing clause "the paste does not print it" is the only
line of the transcribed four that R14 falsified; the property itself holds either way and is
transcribed verbatim, with the correction beneath it and not inside fable's words.
NOT VERIFIED, unchanged: no psql on this box; the plpgsql is still unexecuted anywhere. No SQL
changes at this commit, so marcus's dry-run of `d172be2` does not wait on it.
Applied at this commit: this document only, 158 insertions / 22 deletions, 13 hunks at -U0 --
section 9 step 1 (the 2b(b) dry-run expectation), step 2 (the select gains `s.lapsed_at` and two
`nulls last`, plus the shadowing correction and the two rationales), step 3 (the four properties
transcribed, the correction under them, the second containment limb, the `applied_at` step), the
grep A block (the command-tag paragraph), the grep B block (the strike-9 grep, and (i) and (ii)
rewritten), and section 12 (the heading and this entry).

**R15 -- TEXT, no behaviour. No unsourced pronoun for a person survives in these five files.**
marcus m50496_mu11ykul (2026-09-14 09:40:39Z), standing and applied without a per-round ask on its
own terms: "apply the same rule anywhere else in these files without asking me: where the pronoun is
not sourced, do not have one." R13 took the pronouns off fable and off a client account; the same
defect was still in 68 lines -- 53 in this document, 13 in `0088_tighten.sql`, 1 in
`0088_rollback.sql`, 1 in `0089_drop_server_or_lapsed_exception.sql` -- almost all of them marcus,
two of them coxwell, and R14 had put two fable pronouns back into this section. None of it was ever
sourced: a pronoun inferred from a name is a fact about a real person that nobody in this chain
established, and it reads as certain. 66 lines rewritten, each pronoun replaced by the name
(`marcus's read`), by the artefact (`the Z1 ruling`, `the 08:41Z read`), or dropped where the
sentence already named the owner; `HIS read, not mine` becomes `MARCUS'S read, not mine`, so rule-8
provenance is unchanged everywhere.
NOT touched, same boundary as R13: quoted text keeps the words its author wrote. Fable's Q4 ruling
at :635 (`if he says a listed row WAS told ... with his message id`) and marcus's Z1 words at
:1267-1268 (`his rows were about to be lapsed on a ruling that never mentioned him`) are the two
pronouns left in the file, both inside quotation marks, both about a client and not mine to edit.
One consequential fix fell out of it: :1302 quoted the 0088 text as reading "in his 08:41Z read",
which was true of a line break in the old :661-662; that sentence now states what the two sites
actually say and its `0088:` anchors are re-taken at this commit (:79-80 and :659-662).
Applied at this commit: `docs/specs/0087-tighten.md` 84 insertions / 55 deletions (54 of them the
pronoun lines, the rest the :1302 sentence, the section 12 heading and this entry);
`db/migrations/0088_tighten.sql` 15 / 15; `db/migrations/0088_rollback.sql` 1 / 1;
`db/migrations/0089_drop_server_or_lapsed_exception.sql` 1 / 1. Comments and one `raise notice`
string only -- no SQL statement, predicate, gate, count or expected value is touched, and
`0089_rollback.sql` had no pronoun to fix. The 0088 md5 marcus verified (`4844a7c6...`, the file
through R13 `e6e4ead`, restated in m50496) had already moved at R14; it moves again here.
NOT VERIFIED, unchanged: no psql on this box; the plpgsql is still unexecuted anywhere.

**R14 -- LIVE. The run's `now()` is printed, twice and for two different reasons; step 2b(b) names
every row it is about to touch. marcus m50485_mu11vkq7 (2026-09-14 09:38Z), rulings (1) and (2)
on the three items R12 left open. Behaviour is marcus's ask, the TEXT is fable's: fable rules on all
of it and a fable strike stands over a marcus ruling without returning to marcus (marcus's routing,
same message).**
Ruling (1). Both dry-run properties the paste is checked against are stated relative to the run's
`now()` -- every 4b candidate's `ends_at` before it, every carve-out row's after it -- and no notice
and no summary column in the file carried that instant, so the operator would have had to substitute
a wall clock of their own. Marcus's words for why that is not a small thing: a property you cannot
evaluate from the artefact is not a check. Marcus verified the absence directly, against the held
copy of the file, before ruling. BUILT in the two places marcus named, two different jobs: the
first notice of the run, before the step-0 ledger checks so that an aborting run still stamps itself
(0088:177), and the first column of the step 10 summary row, `now() as run_now` (0088:1284), because
a paste gets split and the instant must not travel in a different message from the counts it dates.
The second is also what names WHICH run a paste is: the dry-run and the apply execute byte-identical
SQL and differ only by their clock and the data. `now()` in both, not `clock_timestamp()` and not a
literal, because it is the function the predicates call -- a stamp the predicates could disagree
with would be worth nothing.
Extended, and flagged as an extension: `0089_drop_server_or_lapsed_exception.sql` gets the same two
(:89, :348). Marcus named two sites in 0088; under m50424 a named list of sites is a floor and the
predicate is what selects the set, and the predicate here is "a pasted run whose gates are evaluated
against `now()`" -- 0089's step 2, step 3 and step 4 gates all are. The two rollback files are NOT
in the set and did not get it: `grep -c 'now()'` returns 1 for `0088_rollback.sql` (a `default now()`
on temp-table DDL) and 0 for `0089_rollback.sql`, neither has a `now()`-relative gate, and neither
has a step 0 or a summary select to hang a stamp on. Whether they should gain one on the "which run
is this" limb alone is left open for fable rather than invented here.
Ruling (2). 2b(b) prints one `step 2b(b) candidate:` line per staged id BEFORE its gate (0088:472),
the same four columns and order as its refusal notice (0088:494) and the same shape as
`step 4b candidate:`. Marcus's reason, which attributes the principle to fable's Z2 rather than to
marcus: name every row the step is about to touch, not only the ones it refuses; 2b(b) is the one
block that acts on a human word rather than on a predicate, so it is where an unnamed row is least
defensible. Costs nothing on today's empty slot (staged=0, no lines) and is the entire record on the
run where the slot is used.
Item (3) is NOT ruled: marcus could not find the select and would not rule on a guess. It is not in
the SQL at all, which is why the `lapsed_at` grep over the file returned only 4b and 2b(b) lines -- the
step-2 select is this document's, section 9 step 2, the fenced block at :844-862 with its column
list at :845-849, and the caveat that names the gap is at :1089-1091 (also :1341). Cited to marcus in
the reply carrying this commit.
Applied at this commit: `db/migrations/0088_tighten.sql` 41 insertions / 3 deletions (header step 0
and step 10 lines, the step-0 stamp, the 2b(b) candidate loop and its block comment, the summary
column and its comment); `db/migrations/0089_drop_server_or_lapsed_exception.sql` 14 / 2 (header
step 0 and step 6 lines, the step-0 stamp, the summary column); this document 118 / 33 (section 3
step 0 and step 10, section 9 step 3 and step 4, the grep A table and the paragraph under it, the
section 12 heading, and this entry). The grep A table's line numbers and the `0088:` anchors in
sections 3, 9 and 12 are RE-TAKEN at this commit, because the SQL edits moved them; the section 12
entries for R4 / R5 / R6 / R8 keep their own anchors, which describe the commits they were written
about and are not renumbered.
NOT VERIFIED, unchanged: no psql or postgres on this box, so none of this plpgsql has been executed
anywhere; `tsc` and lint say nothing about it.

Noted, not struck, and NOT mine: R9 no longer refuses carve-out GROWTH (marcus struck the step-5
SUBSET gate in m50350). Marcus has taken that guard into the apply procedure explicitly (m50396):
read the step-5 carve-out notice, compare it to the expected set, abort if it does not match, same
paste compared between dry-run and apply.

Applied at this commit: 0088 header 4b + step 4b (predicate, candidate notices, comments, expected
counts) + step 5 listing comment, 0088_rollback not-reverted note, 0089_rollback header + section
4 comments, and this document (4b, section 9 step 4, section 12 R9 ruling 1 + this entry).

**R8 (SUPERSEDED by R9, kept as history; text only) -- a live NULL-server row outside the six has ONE fix; 0089's order is
re-key, gate, lapse.** Fable m50023_mtzyhpob (2026-09-13 15:15Z, fable's R5 read, PASS-WITH-STRIKES
Y1/Y2; X1-X4 and R-b CLEARED; 0089 step 2 stays in the NULL-server form as built). Y1: since
2b(b) lapses only the six (fable's X2), "a worded lapse in 2b(b)" is no longer a resolution for a live
NULL-server row OUTSIDE the six. Three places in 0088 (header step 5, the step-5 comment (i), the
step-5 gate (i) raise exception) now say: the fix is a real server row registered before the run
(step 4 re-keys it); otherwise stop and take it to the thread, because the exempt list is not
extended and 2b(b) lapses only the six. The 2b(b) comment carries fable's sentence: no writer inserts
a NULL-server row (Leo m49736); a live one outside the six aborts step 5, so the six are the only
rows a word can lapse here. Contract (fable's answer to m49946): 2b(b)'s staged set is a subset of the
six; a row lapsed by word drops out of step 5's live count and is never pruned from either list.
Y2: the 0088 header does-not-do line and the step-6 "NOT dropped here" comment put 0089's lapse
before its gate; both now read "re-keys the six, gates on none live with a NULL server, lapses
the expired ones, re-adds the CHECK without the exception, drops 0081", the file's order. No SQL
statement changed. Fable's two proof greps: `FILL-IN` in db = 0 (since R6); `fs_no_server_live_exempt`
in db = 0, in docs = 2, both in this section's R4/R5 history records (left as history).

**R6 (SUPERSEDED by R9, kept as history) -- the six full uuids are in; preflight D's NOT NULL server filter is accepted as fact;
the last "step 5's BLOCK set" comment is gone.** Marcus m49945_mtzxrd14 (2026-09-13 14:55Z, a
read-only Neon read of the same instant, marcus's, predicate `server_registration_id is null and status <>
'lapsed' and (ends_at > now() or ends_at is null)`, exactly six rows; NOT my read):
giang2000ln (paid, $30/tier, ends 2026-09-19T17:12:35.462Z) `82147257-d90b-4ed9-a12e-68adeaf0b2d4`,
`4a0a7fb8-0ac2-49f4-b7a8-4007a7c92500`, `00f9e32c-70e8-46f6-a74c-43317edf62c5`; rasoolx55 (trial,
$0, ends 2026-09-25T19:01:33.745Z) `a453d4c0-fcb0-4643-a244-ad6e14273164`,
`2e7ad400-9c26-440c-af09-44db1aa8d254`, `1161625a-72bb-4472-9282-16062f0cad13`. The same read
shows both clients hold the same three `feed_tier_id`s (`19cb2c39-...`, `21842a66-...`,
`a8538ab6-...`), so a preflight D without `server_registration_id is not null` folds the six into
three false (NULL, tier) duplicate groups of count 2: the unique index sees NULLs as distinct, the
count query does not. Marcus accepted the filter on that basis. 0089 = confirmed next free number.
Section 8 still waits on marcus's apply confirmation. m49945 crossed with R5 (it predates af071ca by
14 minutes): its items "step 5 to subset + existence" and "lapse into the 0089 stub" were already
at af071ca and are not re-done here.
Applied at this commit (diff against af071ca): the four FILL-IN lists (0088 `tmp_0088_exempt` and
the CHECK, 0089 `tmp_0089_exempt`, 0089 rollback's CHECK) carry the six literals, each list in the
same order, per-row comments name the client only (the read gives no per-uuid tier mapping, so the
earlier "LD Base tier N" labels are dropped as unverified); the 2b(b) comment that still read
"under v1.71 step 5's BLOCK set is empty by construction" now states the subset gate and the fixed
block's refusal of a staged id outside the six. No SQL statement other than the literals changed.
R6 addendum (fable m49962_mtzxu44x, fable's R4 read, 14:57Z; X1-X4 were already at af071ca/ceeebbe):
R-a accepted the preflight D NOT NULL filter; R-b KEEPS the 2b staging mechanism on three
conditions, met as follows: both staging tables are `on commit drop` (0088:371, :379);
`tmp_0088_lapse_by_word.id` was already `uuid primary key`, `tmp_0088_carry_by_word.legacy_id`
was `uuid not null` and is now `uuid primary key` (a repeat legacy row fails 23505 at staging);
the 2b(b) membership test reads `tmp_0088_exempt` (0088:428, :439). The four "FILL IN" comments
(0088 header, 0088 CHECK comment, 0089 header, 0089 rollback header) now say the uuids are
committed from m49945, since operator fill-in is no longer the mechanism.

**R5 (SUPERSEDED by R9, kept as history) -- step 5 is SUBSET + EXISTENCE, not set-equality; the CHECK is added after the lapse;
2b(b) asserts against the six; the 0089 stub re-keys, gates, LAPSES, re-adds the CHECK, drops
0081.** Ruled by fable, ledger v1.75 (step-5 gate, 2b(b), stub items (i)-(iv)) and v1.76 (stub
order with the lapse step), forwarded verbatim by marcus m49852_mtzwjuib (2026-09-13 14:21Z,
"0088 SCOPE -- RE-ISSUE, SELF-CONTAINED", superseding m49643 and the lost m49590). Marcus struck
set-equality at 13:31Z and fable retracted it independently at ~13:35Z: every legitimate way one
of the six clears before the run (server bound and re-keyed by step 4, expiry, a word in 2b(b))
SHRINKS the set, and equality aborts on a shrink; only growth is dangerous, and the subset test is
what names growth. Marcus's prod read of ~13:37Z (not mine; Leo flagged the ordering): 18
rows `status='active'` with `ends_at <= now()` and NULL server, ALL on licences with zero
`server_registrations`, so step 4 clears none and only the lapse converts them; a CHECK added
before the lapse fails on those 18 with Postgres's 23514. Fable's v1.75 block, in effect:
1. Step 5 gate: abort naming each row if any row has `server_registration_id is null and status
   <> 'lapsed' and (ends_at > now() or ends_at is null)` and its id is not one of the six; abort
   naming it if any of the six does not exist in `feed_subscriptions` (typo guard); the notice
   lists which of the six are still live; summary column `fs_exempt_live` = that count, any 0..6
   passes. Then the lapse (predicate word for word, on `now()`), then the CHECK.
2. 2b(b) assertion: every staged id is one of the six AND live with a NULL server at 2b time.
   "Step 5's BLOCK set" struck there: under v1.71 that set is empty by construction.
3. Follow-up stub (v1.76 order, replacing v1.75 (iii)): (1) 0088 step 4's re-key restricted to
   `id in (<six>)`; (2) gate: rows live under the S4 predicate with an id in the six = 0, else
   abort naming each; (3) LAPSE `update feed_subscriptions set status = 'lapsed', lapsed_at =
   coalesce(lapsed_at, ends_at), updated_at = now() where id in (<six>) and server_registration_id
   is null and status <> 'lapsed' and ends_at <= now();`, row count into the summary; (4) drop
   the CHECK and re-add it without the exemption; (5) drop 0081. Rollback does not revert (3)
   (same reason 0088's rollback keeps the step-5 lapse) and treats (1) as 0088's rollback treats
   step 4 (left as written). (4) holds by construction. Why the lapse belongs there: nothing in the
   system ever writes a lapse, and running out is the most likely way the six clear.
4. Unchanged: the CHECK text; NOT VALID rejected; 0081 kept in 0088; step 6 carries no 0081 drop;
   rollback loses the 0081 recreate and its duplicate-group preflight; T1-T6; 2b(a) untouched.
Marcus's three carried rulings (m49643, restated in m49852 item 8): (a) KEEP
`fs_request_id_rows_dropped` and `legacy_rows_dropped`; (b) the 2b staging mechanism is fable's
to rule; (c) rollback fill-in and the 0087 notice are fine as built. Apply gate unchanged: gated
on coxwell's disposal of the six, nothing added to make step 5 pass; coxwell's two routes in fable's
words: "Either the client registers a real server holding that licence (0088 re-keys the rows if
that happens before the run, the follow-up re-keys them if after), or you word a lapse. Nobody
re-grants the feed onto the new server by hand in between."

Applied at this commit (diff against f5fc622, files 2, 3, 6, 7 of section 1):
- 0088: `tmp_0088_exempt` (same six FILL-IN placeholders) MOVES from step 5 to just before the 2b
  slot so 2b(b) can assert against it; the 2b(b) gate adds `not exists (tmp_0088_exempt)` to
  its bad-row predicate and the notice gains `is_exempt`; the "(step 5's block set)" wording is
  gone. Step 5: gate (i) subset unchanged; gate (ii) "spare exemption, prune" REPLACED by
  existence (each of the six must be a row, else abort naming it); new per-id notice `step 5
  exempt: id=... live_no_server=...`; `fs_exempt_live` replaces `fs_no_server_live_exempt` in
  tmp_0088_counts and the summary; a consistency abort if `live <> exempt_live` after (i); lapse
  and CHECK unchanged in text and order (gate -> lapse -> CHECK, as at efb0d8d :339/:350/:363).
  Every "prune both lists" instruction deleted: the CHECK always carries all six. Header, step 5,
  step 6 and CHECK comments re-cited to m49852 / v1.75.
- 0088 rollback: citation only (v1.71 / v1.75). Shape unchanged from R4 (no 0081 recreate).
- 0089 stub rewritten to the v1.76 order: step 0 ledger + CHECK-text read-back; step 1 re-key
  (0088 step 4's UPDATE with `and fs.id in (select id from tmp_0089_exempt)`, count
  `exempt_rekeyed`); step 2 gate (S4 predicate, id in the six, = 0 else named abort; plus
  outside-the-six = 0 as its own gate); step 3 the lapse, verbatim, count `exempt_lapsed_now`;
  step 4 CHECK without the exception; step 5 preflight D then `drop index` 0081; step 6 summary
  row (`exempt_rekeyed`, `exempt_lapsed_now`, `exempt_already_settled`, `fs_no_server_live`,
  `index_0081_present`) then the ledger row. Header states the rollback does not revert steps 1
  and 3 and why.
- 0089 rollback: header states the two non-reverts; step labels renumbered (5 reverse, 4 reverse).
- Not touched: T1-T6 hunks, 2b(a), 2b(c), the two extra summary columns, the rollback fill-in,
  the 0087 notice, step 6's body (still preflight D with the NOT NULL server filter, no drop).

**R4 (SUPERSEDED by R9; gate wording already superseded by R5) -- step 5 is set-equality against six named rows; the
CHECK carries them by id; the 0081 drop moves to 0089.** Ruled by fable 2026-09-13 12:53Z (ledger v1.71, `3800e9d`), relayed by
marcus m49590_mtztfsz1 (12:54Z) and m49643_mtztu8s7 (13:05Z), on marcus's question
m49538_mtzt2uia (12:44Z, to fable). Marcus's prod read in m49538 (read-only via Neon; NOT
my read): of 39 live feed-tier rows 24 have a NULL server, 18 of those are expired and step 5
lapses them, 6 are live with no server: `giang2000ln` x3 (paid, $30, ends 2026-09-19 17:12Z) and
`rasoolx55` x3 (trial, $0, ends 2026-09-25 19:01Z); servers ever registered by either = 0; giang
is the only paying feed client. Fable rejected both of marcus's options (a partial licence-keyed
twin covering NULL-server live rows; waiting for 09-25) and ruled a third that touches no paying
client and waits on nothing:
1. Step 5 gate = set-equality against the six full uuids (giang `82147257` / `4a0a7fb8` /
   `00f9e32c`, rasool `a453d4c0` / `2e7ad400` / `1161625a`). Any other live NULL-server row
   aborts. Dead rows lapse as already written.
2. The CHECK carries the exception: `status = 'lapsed' or server_registration_id is not null or
   id in (<the 6 literal uuids>)`. Nothing can join the set (uuid primary keys); every new
   NULL-server live row is still refused; the six rows' renewal UPDATEs pass. `NOT VALID` was
   considered and REJECTED: Postgres re-checks every UPDATED row against a NOT VALID constraint,
   so giang's renewal would fail 23514, the same paying client cut by another route.
3. Step 6: preflight D as written, the 0081 drop moves out to the follow-up. The rollback no
   longer recreates 0081 and no longer needs its duplicate-group preflight.
4. A follow-up migration, its own number, applied once all six are bound or lapsed: gate
   live-rows-with-an-exempt-id = 0, drop and re-add the CHECK without the exception, drop 0081.
   The REMOVAL POINT comment at feed-subscriptions.ts:392 and the section-8 cleanup sentence
   re-point there.
Scope fable set: step 5, the CHECK, step 6, the rollback, this section, the stub. T1-T6 unchanged.
The apply stays gated on coxwell; the exemption is a ruling with named ids and a removal, not a
softened guard.

Applied at this commit (diff against 9c62556, files 2, 3, 6, 7 of section 1):
- 0088 step 5: `tmp_0088_exempt` (six literal ids, FILL-IN placeholders until marcus supplies the
  full uuids; they are not in my reads, the bus carries only the 8-char prefixes) and two gates,
  live-not-exempt = 0 (BLOCK, rows named) and exempt-not-live = 0 (a spare exemption is refused;
  prune both lists). New summary column `fs_no_server_live_exempt`; `fs_no_server_live` now
  expects 6, not 0. The CHECK gains the `id in (...)` branch; a DO block after ADD CONSTRAINT
  reads `pg_get_constraintdef` back and aborts unless every exempt id is in the text and the
  text carries exactly that many uuid literals.
- 0088 step 6: preflight D adds `server_registration_id is not null` to its WHERE. As written it
  would have aborted on the six: they are two subscribers on the same three tiers, and GROUP BY
  treats their NULL servers as one group per tier (count 2, three false duplicate groups) where
  the unique index treats NULLs as distinct. Flagged to marcus as the one change inside "preflight
  D as written". The `drop index` statement is gone; the 0081 twin is named as staying.
- 0088 rollback: step-6 reverse block deleted (no recreate, no duplicate preflight); preflight
  refuses a '0089' ledger row (0089_rollback.sql runs first); header restore list updated.
- 0089_drop_server_or_lapsed_exception.sql + 0089_rollback.sql: stubs as item 4, with the same
  FILL-IN list, a step-1 read-back of the live CHECK text (list must match as applied), and the
  duplicate-group preflight relocated to the rollback's 0081 recreate. Number 0089 = next free in
  db/migrations at this branch (0087 parked, Leo; 0088 this file); marcus confirms.
- Not touched (marcus m49643): 2b(a)/(b)/(c), T1-T6 hunks, the two extra summary columns (KEEP,
  marcus's ruling 3(a)), the 2b staging mechanism (fable's to strike or keep, 3(b)), the rollback
  fill-in and the 0087 notice (3(c)). The 2b(b) gate comment at 0088:384 still says "exactly
  step 5's block set"; the gate itself (staged ids must be live no-server rows) still holds, and a
  worded lapse of an exempt row is legitimate provided the list is pruned. Left as is, flagged.

R1 and R3 were marcus's rulings of 23:26Z and 23:29Z, made before fable's 23:23Z review had been
read, and WITHDRAWN by marcus in m49215_mtz0lxlf (23:27Z, "fable governs") and again in m49385
(2026-09-13 11:00Z); fable's m49231_mtz0pepn (23:30Z; confirmed landed in fable's m49478) rules:
CHECK stays, step 5 stays BLOCK, no no-server partial index. "No `assertNoLiveGrant` rewrite" is
from fable's m49201_mtz0hlbm CLEANUP COMMIT, not m49231 (cite fixed in v4). The 7527d3c and 6f2ada9 edits
that applied R1 and R3 are reverted since v3; nothing below R2 is in force. The text is kept so
the thread's history reads without the bus. Numbering, so nobody re-derives it (fable m49479):
fable's m49231 "R1 and R2" use m49213's numbering; that "R2" (drop the CHECK) is this section's R3,
and this section's R2 (0088) is live.

**R1 (WITHDRAWN m49215) -- step 5 live no-server rows: WARN + list, not BLOCK.** Ruled by marcus,
m49194, 23:26Z, thread kai-tighten-0087-2026-09-12. Cited read (marcus, prod, SELECT only,
23:24Z; relayed, not my read):
- Subscriber A: LD Base x3 tiers (19cb2c39 / 21842a66 / a8538ab6), status active, $30, 09-04 to
  09-19, licence 176ca960 PAID expires 09-19, rows 82147257 / 4a0a7fb8 / 00f9e32c.
- Subscriber B: LD Base x3 same tiers, status active, $0, 09-04 to 09-25, licence 6865647f TRIAL
  expires 09-25, rows a453d4c0 / 2e7ad400 / 1161625a.
- `server_registrations` for either user or either licence: 0 rows.
Reasoning as ruled: subscriber A is the only paying feed client; lapsing to satisfy a preflight
destroys revenue to fit a schema. Coxwell's 18:07Z Arm B ruling (servers register freely without
a licence, licence allocated to a server later) makes "subscription bound to a licence, no server
yet" a legitimate post-tighten state. Both are 0081-cohort backfills from before server binding.
Disposition: step 5 preflight = WARN + list; `server_registration_id` stays nullable; no lapse;
no synthetic server row. Fable's Q1-Q7 pass overrides if it says otherwise; a conflict goes to
marcus, not picked by kai.
Consequence flagged to marcus in the same reply: the header's CHECK `server_or_lapsed` cannot be
added while these 6 rows are `active` with NULL server. Outcome after withdrawal: the CHECK stays
and the 6 rows are coxwell's to resolve through step 2b(b) (a real server row, or a worded lapse).

**Item 2 (31cd1813)** as ruled with R1: separate SQL file from kai, before the tighten. WITHDRAWN
with R1; fable closed it as a step-2b literal in this file (CONFLICT 2, marcus m49385 item 3).
**Item 1 (carry, Q4)**: ruled by fable Q4 (section 5).

**R2 (LIVE) -- migration number is 0088, not 0087.** Ruled by marcus, m49203_mtz0i4xj, 23:24Z, same
thread. Leo's feed_tiers connection-fields migration took 0087 on branch
`leo/feeds-connection-fields-2026-09-12` at 6b70486 (my read of that commit's tree:
`db/migrations/0087_feed_tiers_connection_fields.sql` inserts `schema_migrations` version
'0087' at :46; `db/migrations/0087_rollback.sql` deletes '0087' at :28). Not on origin/main as
of 09f8352; PARKED by marcus m49474_mtzsh4hu (2026-09-13 12:27Z): number reserved, not merged,
not applied, independent of 0088 (feed_tiers only). Fable confirmed the reading (marcus
m49385: the ledger records the SQL files as 0088, spec filename and thread stay 0087). Applied in
this v3:
- Section 3 file is `db/migrations/0088_tighten.sql`; section 4 file is
  `db/migrations/0088_rollback.sql`; section 1 table rows 2 and 3 rename accordingly.
- Step 0 preflight: `schema_migrations` has '0086', does not have '0088'; '0087' neither
  required nor forbidden (v3 required it and would have aborted on prod, fable T5; fixed in v4).
- Ledger insert becomes `('0088', '0088_tighten.sql')`; rollback deletes '0088'; section 9
  step 5 expects '0088' in `schema_migrations`.
- Branch `kai/tighten-0087-2026-09-12`, thread `kai-tighten-0087-2026-09-12` and this file's
  name stay as they are.

**R3 (WITHDRAWN m49215 / fable m49231) -- the `server_or_lapsed` CHECK leaves the tighten; the
0081 index drop gets a no-server replacement index.** Ruled by marcus, m49207_mtz0iz0q, 23:29Z,
same thread, retracted in m49215 before I had read the retraction; 6f2ada9 was built on
it and is reverted here. The coverage analysis below was correct for the schema R3 described;
with the CHECK in place its predicate set is empty and the cross-half question is moot.
- Option (a), not (b): a `not valid` CHECK would still assert, for every future row, a rule
  that coxwell's 18:07Z Arm B (servers register freely, licence allocated to a server later)
  makes false. A licence-bound live subscription with no server yet is legitimate going forward,
  so the constraint is wrong, not premature. No CHECK in this file, no CHECK in the rollback.
- Knock-on ruled with it: `create unique index feed_subscriptions_subscriber_feed_tier_live_noserver_uidx
  on feed_subscriptions (subscriber_user_id, feed_tier_id) where server_registration_id is null
  and status <> 'lapsed'`, in step 6 BEFORE `drop index feed_subscriptions_license_feed_tier_live_uidx`.
  With the 0086 `feed_subscriptions_server_feed_tier_live_uidx` (server, tier) the pair covers
  both halves. My reads behind that: 0086:657-659 (server index predicate `feed_tier_id is not
  null and status in ('trial','active')`), 0081:275-277 (the index being dropped, keyed on
  `license_id`, which 0086:652-653 made nullable), 0071:49 (`status` domain is exactly trial /
  active / lapsed, so `<> 'lapsed'` is the same live set).
- Said before writing, as marcus asked: no single live row is left outside both indexes. The
  pair does not forbid one (subscriber, tier) held live in both halves at once (one row with a
  server, one without); the 0081 index forbids that today only when both rows share
  `license_id`. Step 6 states it; section 8 keeps a subscriber-keyed second query in
  `assertNoLiveGrant` in place of the licence-keyed one (proposal). Section 11 gains two reads
  for marcus: the no-server duplicate groups (must be 0 or the CREATE fails) and today's
  cross-half count.
- Was applied in 6f2ada9 to: section 2 scope-note (b), step 5 last bullet, step 6, section 4
  rollback list, section 8 first bullet, section 9 dry-run item 1 and schema-read item 5,
  section 11 Q8 and two reads. All of it reverted in v3; none of it is in force. Nothing built.
