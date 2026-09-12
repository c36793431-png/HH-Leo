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

Author: kai. Branch: `kai/tighten-0087-2026-09-12`, off origin/main `9e84f16` (3ded80d = phase-2
merge, 22:58Z; 9e84f16 = Leo's revenue-history date fix on top). Reviewer: fable. Owner: marcus.
Product owner: coxwell. Thread: kai-tighten-0087-2026-09-12 (marcus m49169).

Status: SPEC ONLY. No migration file and no code until fable PASSes this document. Every "Source X"
is the verbatim ledger text banked in `docs/specs/0086-phase2-ledger-extract.md`. "0086 header"
means the DEPLOY ORDER block of `db/migrations/0086_marketplace_recut.sql` as merged (lines 59-104
at 9e84f16), which is the ledger's own statement list for this file. Anything that is not a Source
citation or a header quote is a PROPOSAL and is marked so. Line anchors are at `9e84f16`.

Not in my reads, stated up front so nobody takes a relay for a finding (rule 8):
- The provisioning ledger's own section 9 text (provider panel lock). I have the 0086 spec's
  section 9 interval statement, which cites it (fable m48897, marcus m48906); the bus GET by short
  id returns "not found" for those two. Section 6 below quotes what I have and asks fable for the
  paragraph.
- Fable's B-1 sentence. Section 7 quotes marcus m49169's relay of it and asks for her words.
- Every prod count. Section 11 lists the SELECTs; marcus runs them.

---

## 1. Files to touch (declared before touching)

| # | File | State at 9e84f16 | Change |
|---|------|------------------|--------|
| 1 | `docs/specs/0087-tighten.md` | NEW | This document. |
| 2 | `db/migrations/0087_tighten.sql` | NEW | Section 3. Written only after PASS. |
| 3 | `db/migrations/0087_rollback.sql` | NEW | Section 4. Written in the same commit as file 2. |
| 4 | `src/lib/feed-subscriptions.ts` | :388-411 `assertNoLiveGrant` (second query = the 0081 window check, REMOVAL POINT comment :392-393); :37-45 `CreateSubscriptionInput` comment; :1295-1302 comment | Code cleanup AFTER the migration is applied (section 8): delete the second query, rewrite the three comments that say "until the tighten". Separate commit. |
| 5 | `src/lib/access-requests.ts` | :323 comment ("or on the 0081 licence index") | Comment only, same cleanup commit. |

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
- `src/app/feed/dashboard/*`, `src/lib/feed-providers.ts`: NOT opened in this job unless fable rules
  section 6's proposal in AND marcus clears the collision (Leo committed to `/feed/dashboard` three
  times today: 133ecc3, 592007d, 9e84f16).
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
replacement no-server index (section 3 step 6, section 12 R3; was "the CHECK" in v1) must exist
before the 0081 index goes or a live row with NULL server would be covered by no unique index
(NULLs are distinct under the 0086 server index), and (c) the section-3 re-run is what makes the
`request_id` DROP COLUMN lossless (section 3 step 2). If fable or marcus want the three named
statements split from the rest, the order below already isolates them as steps 8-9 and the split is
a file boundary, not a redesign. RECOMMENDATION: one file.

---

## 3. `db/migrations/0087_tighten.sql` -- statement order, each step with its guard

One transaction, `begin` ... `commit`, DO-block gates that `raise exception` (whole transaction
aborts) or `raise notice` with counts, the 0086 discipline. Marcus dry-runs it once with `rollback`
in place of `commit` and pastes every notice line, then runs it for real (section 9). Header: what
the file does, in order, with file/line/ledger-version references only; no sentence about who
decided or ruled anything (the 0084 rule, marcus m49169).

**0. Ledger row preflight.** `schema_migrations` has `'0086'` and does not have `'0087'`; else abort.

**1. Section 1 re-run (header 93-95).** `update server_registrations sr set user_id = l.user_id
from licenses l where l.id = sr.license_id and sr.user_id is null`; gate `count(*) where user_id is
null = 0` else abort. Expected UPDATE 0 on prod (Leo's writer has been live since 3ded80d; the
window rows are those registered between 17:30Z and 22:58Z). `updated_at` untouched (0086 rule).

**2. Section 3 re-run with predicate (iv) (header 109-110, Source M).** Same two temp tables and
two INSERTs as 0086 lines 230-244 and 446-497, with ONE change: `tmp_0087_skipped_requests` adds
```
  and not exists (select 1 from access_requests a where a.legacy_feed_tier_request_id = ftr.id)
```
as the fourth conjunct. The envelope upsert keeps `on conflict (id) do update ... where
access_requests.decided_at is null` (0086:483-488, Source I strike 6) so no decision made through
the new path is reverted. Same gate as 0086:504-530 (`mapped_legacy = legacy_rows - skipped`,
`envelopes = details`). Then the `access_request_id` backfill from `request_id` at tier grain
(0086:542-548) and its gate (0086:551-565): `count(*) from feed_subscriptions where request_id is
not null and access_request_id is null = 0`. THIS GATE IS THE READER CHECK FOR STEP 8: after it,
every fact `request_id` carried is carried by `access_request_id` (row-level) plus
`access_requests.legacy_feed_tier_request_id` (request-level), so the DROP COLUMN loses nothing.

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
row 31cd1813 (Source N); its status decides whether this file can run at all. Runs AFTER step 2 so
a row the old code wrote in the window and step 2 just carried is not listed.

**4. Section 4 re-run (header 93-95).** `server_registration_id` backfill via licence -> server
(0086:581-585) and its gate (`left_null = no_server`, 0086:590-604); `ends_at` re-seed for rows
still NULL, non-trial from the licence and trial from `feed_tier_trials` (0086:610-629); gate
`active rows with ends_at NULL = 0` (0086:633-648). Expected UPDATE 0 / 0 / 0 on prod (phase-2
writers set all three columns; 0086 spec section 10 step 7 is the post-deploy invariant).

**5. NULL-server disposition, then the CHECK (header 80-86).** Listing, one notice per row, of
every `feed_subscriptions` row with `server_registration_id is null`: `id, subscriber, tier,
status, ends_at, computed = (ends_at > now())`. Then:
- WARN + list (ruled marcus m49194 23:26Z, section 12 R1; was BLOCK in v1 of this document):
  `count(*) where server_registration_id is null and status in ('trial','active') and ends_at >
  now()` is noticed with every row named; it does NOT abort. These rows are 0081-cohort backfills
  bound to a licence before server binding existed; under coxwell's 18:07Z Arm B ruling
  (servers register without a licence, licence allocated to a server later) "subscription bound
  to a licence, no server yet" is a legitimate post-tighten state. No lapse, no synthetic server
  row. Column stays nullable. Prod read 23:24Z: 6 such rows (section 12 R1).
- LAPSE the dead ones inside the transaction:
  ```
  update feed_subscriptions
  set status = 'lapsed', lapsed_at = coalesce(lapsed_at, ends_at), updated_at = now()
  where server_registration_id is null and status in ('trial','active') and ends_at <= now();
  ```
  PROPOSAL: `lapsed_at = coalesce(lapsed_at, ends_at)` (0071 has `lapsed_at`; the truthful lapse
  instant is the seeded `ends_at`, and `now()` would date a 2026-09-06 expiry to the tighten).
  Computed status does not move for these rows (they already compute `lapsed` through the licence
  branch, `l.expires_at > now()` false); stored status now agrees with computed. Test plan names
  them as the ONLY stored-status movers and ZERO computed movers.
- NO CHECK. **RULED (section 12 R3, marcus m49207 23:29Z; fable overrides):** the header's
  `feed_subscriptions_server_or_lapsed_chk` (0086 header :75-76 target statement) LEAVES the
  tighten. Not added `not valid` either: under Arm B a licence-bound live subscription with no
  server yet is a legitimate state for every future row, so the rule the CHECK asserts is wrong,
  not merely premature. The v1 CONFLICT note that stood here is resolved by R3. The header
  target list (0086:75-77, "add the CHECK, and drop the 0081 index" at :96-97) changes:
  flagged for fable in section 11 as Q8.

**6. Preflight D re-run, create the no-server index, then drop the 0081 index (header 77,
95-97; section 12 R3).** Duplicate groups on `(server_registration_id, feed_tier_id)` among live
rows (0086:327-344) must be 0 (structurally true: `feed_subscriptions_server_feed_tier_live_uidx`
exists since 0086 and covers every live row whose server is NOT NULL). Live rows with NULL
server (the 6 of R1, plus any future Arm B row) are NOT under that index (NULLs are distinct), so
BEFORE the 0081 index goes, in the same transaction:
```
create unique index if not exists feed_subscriptions_subscriber_feed_tier_live_noserver_uidx
  on feed_subscriptions (subscriber_user_id, feed_tier_id)
  where server_registration_id is null and status <> 'lapsed';
```
(predicate as ruled; `status <> 'lapsed'` equals `status in ('trial','active')` because 0071:49
constrains `status` to exactly those three values, so it is the same live set as the 0086 and
0078 indexes. Postgres validates at CREATE, so the create is its own gate; the added preflight
read in section 11 shows the duplicate count ahead of the dry-run.) Coverage after this step, my
read of the three predicates: a live row with server NOT NULL is under the 0086 index
(server, tier); a live row with server NULL is under the new index (subscriber, tier); no live
row is outside both. NOT prevented by the pair, said before writing as asked: the same
(subscriber, tier) held live TWICE, once server-less and once server-bound. Today the 0081 index
forbids that pair when both rows carry the same `license_id`; after the drop nothing does. In
`src` at 9e84f16 the only writer-side guard for it is the second query in `assertNoLiveGrant`
(feed-subscriptions.ts :403-410, the `license_id` window check) that section 8 deletes. Section 8
therefore REPLACES that query instead of deleting it (see there); marcus rules if he wants the
cross-half pair forbidden at the schema too (it cannot be one index: the two halves key on
different columns). Then `drop index if exists
feed_subscriptions_license_feed_tier_live_uidx;`. Nothing in `src` names that index in an `ON
CONFLICT` (my grep: the only mentions at 9e84f16 are the comment at feed-subscriptions :392 and the
comment at access-requests :323); the window check at :403-410 is a plain SELECT and keeps working
until the section-8 cleanup deletes it. Not dropped: the 0078 `provider_tier` twin
(`feed_subscriptions_subscriber_provider_tier_live_uidx`), outside the ledger's list.

**7. server_registrations: `user_id SET NOT NULL` and the 5(b) FK switch (header 74, 148-150).**
`alter table server_registrations alter column user_id set not null;` (gate = step 1). Then, in a
DO block that looks the FK up by `conrelid = 'server_registrations'::regclass and confrelid =
'licenses'::regclass and contype = 'f'` (0031 created it unnamed, so the default name
`server_registrations_license_id_fkey` is expected but not assumed): drop it, re-add
`foreign key (license_id) references licenses(id) on delete set null`, notice the name it found.
`unique (license_id)` kept as-is (Source B: swap dropped; NULLs distinct). No writer NULLs
`license_id` in this file and none exists in code (section 7).

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

**10. Summary SELECT and the ledger row.** One row: `sr_user_id_null` (0), `fs_no_server_live`
(6 expected per section 12 R1; a notice, not a gate),
`fs_no_server_lapsed_now` (step 5's UPDATE count), `fs_request_id_column_present` (false, from
`information_schema.columns`), `ftr_table_present` (false, from `to_regclass`),
`allowlist_carried` (section 5 count), `allowlist_open_total`, `access_requests_rows`,
`legacy_no_envelope_rejected` (step 3's rejected count, dropped). Then `insert into
schema_migrations (version, name) values ('0087', '0087_tighten.sql') on conflict do nothing;`
`commit;`

---

## 4. `db/migrations/0087_rollback.sql`

Same discipline as 0086_rollback.sql: written in the same commit, never run automatically, states
what it cannot restore first. Reverse order of section 3.

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
feed_tier_id)` duplicate groups, else abort), then `drop index if exists
feed_subscriptions_subscriber_feed_tier_live_noserver_uidx` (R3; no CHECK to drop, none was
added), `user_id DROP NOT NULL`, FK back to `on delete cascade`, delete the carried allowlist rows (`told_at <
'2026-09-12T17:30:00Z'`: `feed_allowlist_records` did not exist before the 0086 apply, so an
earlier `told_at` can only be a carried row; guard = that count equals the summary's
`allowlist_carried`, else abort), delete the `'0087'` ledger row. The step-5 lapse is NOT reverted
(stored `lapsed` on a row whose `ends_at` is past is truthful either way); stated, not hidden.

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
from tmp_0087_carry c
where not exists (select 1 from feed_allowlist_records r
                  where r.server_registration_id = c.server_registration_id
                    and r.feed_tier_id = c.feed_tier_id and r.ip = c.ip and r.revoked_at is null)
on conflict (server_registration_id, feed_tier_id, told_at) do nothing;
```
where `tmp_0087_carry` is the SELECT above. Post-gate: for every distinct (server, tier, ip) in
`tmp_0087_carry` an open record exists (count of misses = 0). Notice: rows enumerated, rows
inserted, rows skipped because an open same-IP record already existed (a legacy grant that was
ALSO re-approved through the new path since 22:58Z).

PROPOSAL, flagged, not designed around: legacy rows with `status = 'approved'` that never reached
`'provisioned'` get NO record. Source G(d) names the `'provisioned'` set only; whether an
`'approved'`-only legacy row means "vendor told" is coxwell's, so section 11 asks for their count
and list and this file carries none of them unless fable says otherwise.

`told_by` (Source I, optional; 0086 spec 4(a) said "if fable wants it, it goes in the tighten
file"): PROPOSAL = not added. Carried rows COULD set it (`actioned_by`), but the phase-2 writer does
not write it and a column half the rows fill is the ledger section 1.5 shape the recut removed. One word from
fable flips this: then `told_by uuid references users(id)` is added in step 9 before the INSERT,
carried rows get `actioned_by`, and the section-8 cleanup passes `decided_by` from the approval
path.

After this step the vendor record set is no longer PARTIAL (0086 spec section 9 interval
statement; section 11 item 4): every grant the vendor was told about under the old flow and every
grant approved or directly granted under the new flow has an open record.

---

## 6. Item (3): the provider-panel unlock

What I have, verbatim from `docs/specs/0086-phase2-code.md` section 9 (P2 interval statement):
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

The unlock = the lock's negation: after 0087 applies, a provider surface MAY present the record set
as the truth of what the provider has been told. PROPOSAL for what changes on `/feed/dashboard`
(fable rules; the ledger's section 9 text is what I need to check this against):
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
Ownership: those two files are in Leo's active area today (section 1); if ruled in, kai declares
them again to marcus and does not open them until he rules. If fable rules the unlock is a
statement of permission only (no surface changes in this slice), this section becomes one sentence
in the migration header's "after apply" note and no UI file is touched.

---

## 7. Item (4): the B-1 dependency

As marcus relayed it in m49169 (fable's own sentence is not in my reads; asked for in section 11):
"B-1 is one commit AFTER the tighten AND the phase-2 merge, and the licence-less-server 23502 guard
ships with B-1, not here."

What that binds in this file:
- Nothing here inserts or updates a `server_registrations` row with `license_id NULL`, and no code
  at 9e84f16 does either (server-registration.ts :180-195 always passes `licenseId`).
  `server_registrations.license_id` has been nullable since 0086 section 1, so the 23502 that B-1
  guards against is not on that column; it is whatever `not_null_violation` a licence-less
  registration trips on the write path B-1 introduces (I do not know B-1's write shape and do not
  design for it). This file only makes the schema ready for B-1: `user_id NOT NULL` (the owner
  survives a missing licence), FK `on delete set null` (a deleted licence no longer deletes the
  server), `unique (license_id)` kept (NULLs distinct, so N licence-less servers do not collide).
  The guard itself ships with B-1, not here.
- The window rule (Source B) is NOT retired by this file. Its stated end is "until the tighten",
  but `EFFECTIVE_STATUS_SQL` at 9e84f16 :144-146 still reads `licenses l where l.id = s.license_id`
  (the flip (c) has not run, v1.47/v1.49: coxwell's separate word), so a `feed_subscriptions` row
  with `license_id NULL` would compute `lapsed` today. Phase-2 writers keep writing `license_id`
  from the server row (access-requests.ts :328-330; feed-subscriptions.ts :331) and this spec
  changes no writer. Retiring the window rule is the flip's, or B-1's, to state. FLAG for fable:
  the ledger sentence and the code disagree on when the window ends; I am following the code.
- Order on main: phase-2 merge (3ded80d, done) -> this tighten (0087 applied, then the section-8
  cleanup commit) -> B-1. The cleanup commit is part of the tighten, not B-1.

---

## 8. Code cleanup after apply (declared in section 1; separate commit, after marcus confirms apply)

- feed-subscriptions.ts :388-411 `assertNoLiveGrant`: the `if (args.licenseId)` second query
  (:403-410, keyed on `license_id`) and the REMOVAL POINT paragraph (:388-393) go; `licenseId`
  leaves the args type; the two callers (access-requests.ts batch create and approval,
  feed-subscriptions.ts direct grant) drop the argument. R3 CHANGE (was "delete, new-key query
  alone"): in its place a second query keyed on the subscriber, `where subscriber_user_id = $1
  and feed_tier_id = $2 and server_registration_id is null and status in ('trial','active')`,
  so a server-bound grant is refused while the same subscriber holds a live server-less row on
  that tier (the cross-half pair step 6 says the two indexes do not forbid). `subscriberUserId`
  is already in scope at both callers (it is written into the same INSERT). Behaviour: two
  queries, one per half of the step-6 pair, mirroring the schema. PROPOSAL, marcus rules.
- feed-subscriptions.ts :37-45 and :1295-1302, access-requests.ts :323: comment text that says
  "until the tighten" / "or on the 0081 licence index" / "drops with the old table in the tighten"
  is rewritten to the past tense with the 0087 reference. No behaviour.
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
no-server live rows) is known BEFORE the dry-run, not discovered by it.

**Prod, dry-run then apply, by marcus:**
1. Dry-run: the file with `rollback;` in place of `commit;`. Every notice line pasted. Expected:
   step 1 UPDATE 0; step 2 INSERT 0 / 0 unless the window wrote requests (then N, named); step 2
   gate `unmapped=0`; step 3 lists 31cd1813 (status decides: `rejected` = continue, `pending` =
   abort here); step 4 UPDATE 0/0/0; step 5 warn count 6 (named, section 12 R1) and lapse count
   = the dead no-server rows (named); no CHECK (R3); preflight D 0; step 6 no-server index
   CREATE succeeds (fails = a live no-server (subscriber, tier) duplicate, which the added
   section-11 read shows ahead: expected 0, the 6 R1 rows are 2 subscribers x 3 distinct tiers
   per marcus's relayed read); step 7 FK name found; step 8 `request_id` rows with
   a value = the 0086 apply's `with_request` count, unmapped 0; step 9 carry enumerated = the
   `provisioned_to_map` count expanded by package membership, inserted = that minus same-IP
   overlaps with new-path records, misses 0; drop guard 0; summary row.
2. Before-read (v1.47 gate shape, S5(b)): `select id, subscriber_user_id, feed_tier_id, status,
   ends_at, server_registration_id, <EFFECTIVE_STATUS_SQL> as computed from feed_subscriptions
   order by id` -- the same read marcus used for the 0086 dry-runs.
3. Apply (`commit`). Paste every notice line; they must equal the dry-run's.
4. After-read = before-read plus EXACTLY: stored `status` `active`->`lapsed` on the step-5 rows
   (named ahead from the before-read: `server_registration_id is null and status in
   ('trial','active') and ends_at <= now()`), `computed` unchanged on every row. Any other mover
   means the file is wrong and the rollback runs.
5. Schema reads: `information_schema.columns` has no `feed_subscriptions.request_id`;
   `to_regclass('feed_tier_requests') is null`; `pg_indexes` has neither
   `feed_subscriptions_request_tier_uidx` nor `feed_subscriptions_license_feed_tier_live_uidx`,
   and HAS `feed_subscriptions_subscriber_feed_tier_live_noserver_uidx` with the step-6
   predicate (R3); `pg_constraint` has NO `feed_subscriptions_server_or_lapsed_chk` (R3) and has
   the new `server_registrations` FK with `confdeltype = 'n'`; `server_registrations.user_id` is
   `is_nullable = 'NO'`; `'0087'` in `schema_migrations`.
6. Allowlist read: `select server_registration_id, feed_tier_id, ip, told_at from
   feed_allowlist_records where told_at < '2026-09-12T17:30:00Z' order by told_at` = the carry
   list from section 5, row for row; `select count(*) ... where revoked_at is null` = summary
   `allowlist_open_total`.
7. App smoke after apply, before the cleanup deploy: Request Access on a registered server and an
   admin approval both succeed (the window query still runs, now against no index: plain SELECT);
   the admin queue and the provider Overview render; `/feed/dashboard/subscribers` renders the same
   rows as before apply (no reader of the dropped objects).
8. After the cleanup deploy: repeat 7; the duplicate-grant refusal still fires on a second approval
   of the same (server, tier) (`DuplicateTierGrantError` from the new-key query alone).
9. If section 6 is ruled in and built: the Subscribers page IP cell shows the told IP and told_at
   for every carried row and every new-path row; a row whose `declared_ip` differs shows both.

Rollback of the schema is `0087_rollback.sql` (section 4). Rollback of the cleanup commit is a
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

**For fable (rulings needed before the file is written):**
- Q1 Scope: one file (recommended, section 2 note) or the three named statements split out.
- Q2 `lapsed_at = coalesce(lapsed_at, ends_at)` on the step-5 dead rows, or `now()`, or leave NULL.
- Q3 `told_by`: not added (proposal) or added with `actioned_by` / `decided_by`.
- Q4 Legacy `status = 'approved'`-not-`'provisioned'` rows: no record (proposal) or carried.
- Q5 Section 6: surface change on `/feed/dashboard/subscribers` in this slice, or permission only.
- Q6 The window rule's end: section 7 flag (ledger says tighten, code says flip).
- Q7 Your B-1 sentence verbatim, and the ledger's section 9 paragraph verbatim, so v2 of this
  document quotes them instead of marcus's relay and the 0086 spec's citation.
- Q8 (ADDED after your Q1-Q7 pass; marcus m49207 asked that it be marked for you explicitly
  because it changes the header TARGET LIST, 0086:75-77 and :96-97). Section 12 R3: the
  `server_or_lapsed` CHECK leaves the tighten (not `not valid`, not deferred: wrong under Arm B),
  and the 0081 index drop gains a replacement in the same step,
  `feed_subscriptions_subscriber_feed_tier_live_noserver_uidx` on (subscriber_user_id,
  feed_tier_id) where server_registration_id is null and status <> 'lapsed'. Your Q1 ordering
  ("CHECK before 0081 index drop") reads as "no-server index before 0081 index drop". Also the
  cross-half pair in step 6 and the section-8 replacement query. Marcus ruled; you override.

**For marcus (read-only, prod, paste the outputs; none of these I can run):**
```
select count(*) from feed_tier_requests;                                            -- legacy_rows
select status, count(*) from feed_tier_requests group by status order by status;    -- incl. provisioned_to_map, approved-only
select count(*) from feed_subscriptions where request_id is not null;               -- with_request
select count(*) from feed_subscriptions where request_id is not null and access_request_id is null;  -- must be 0
select count(*) from server_registrations where user_id is null;                    -- must be 0
select count(*) from feed_subscriptions where server_registration_id is null;       -- fs_no_server (0086 named 6?)
select count(*) from feed_subscriptions where server_registration_id is null and status in ('trial','active') and ends_at > now();   -- step-5 WARN count (RUN 23:24Z: 6, section 12 R1)
select count(*) from feed_subscriptions where server_registration_id is null and status in ('trial','active') and ends_at <= now();  -- step-5 lapse count
select subscriber_user_id, feed_tier_id, count(*) from feed_subscriptions where server_registration_id is null and status <> 'lapsed' and ends_at > now() group by 1, 2 having count(*) > 1;  -- R3: step-6 no-server index would fail on any row here; expect 0 rows
select count(*) from feed_subscriptions fs where fs.server_registration_id is null and fs.status <> 'lapsed' and exists (select 1 from feed_subscriptions o where o.subscriber_user_id = fs.subscriber_user_id and o.feed_tier_id = fs.feed_tier_id and o.server_registration_id is not null and o.status <> 'lapsed');  -- R3: cross-half pairs the two indexes do not forbid; today's count
select count(*) from feed_allowlist_records;                                        -- new-path records so far
select conname, confdeltype from pg_constraint where conrelid = 'server_registrations'::regclass and contype = 'f';
select count(*) from pg_constraint where confrelid = 'feed_tier_requests'::regclass;  -- expect 1 (the 0078 FK)
select count(*) from feed_tier_requests where status = 'provisioned' and actioned_at is null;  -- guard (b), must be 0
```
plus the two listings: section 3 step 3 (no-envelope rows) and section 5 (the carry SELECT). The
"6?" is my recollection of Q25's no-server London clients from the 0086 spec, not a read; the
count is whatever the SELECT says.

Nothing in this document has been run against prod by kai. No file other than this one exists on
the branch.

---

## 12. Rulings ledger (rulings received after v1, with the read each cites)

**R1 -- step 5 live no-server rows: WARN + list, not BLOCK.** Ruled by marcus, m49194, 23:26Z,
thread kai-tighten-0087-2026-09-12. Cited read (marcus, prod, SELECT only, 23:24Z; relayed, not my
read):
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
Consequence (flagged to marcus in the same reply, RESOLVED by R3 below): the header's CHECK
`server_or_lapsed` cannot be added while these 6 rows are `active` with NULL server; R3 removes
the CHECK from the tighten.

**Item 2 (31cd1813)**: separate SQL file from kai, lands before 0087, not folded in. In front of
coxwell as of 23:19Z; open. **Item 1 (carry, Q4)**: wait for fable.

**R2 -- migration number is 0088, not 0087.** Ruled by marcus, m49203_mtz0i4xj, 23:24Z, same
thread. Leo's feed_tiers connection-fields migration took 0087 on branch
`leo/feeds-connection-fields-2026-09-12` at 6b70486 (my read of that commit's tree:
`db/migrations/0087_feed_tiers_connection_fields.sql` inserts `schema_migrations` version
'0087' at :46; `db/migrations/0087_rollback.sql` deletes '0087' at :28). Not on origin/main as
of 09f8352; it applies before the tighten, so the order holds. Consequences for this spec, applied
when v2 is written (no other action now):
- Section 3 file is `db/migrations/0088_tighten.sql`; section 4 file is
  `db/migrations/0088_rollback.sql`; section 1 table rows 2 and 3 rename accordingly.
- Step 0 preflight becomes: `schema_migrations` has '0086' AND '0087', does not have '0088'.
- Ledger insert becomes `('0088', '0088_tighten.sql')`; rollback deletes '0088'; section 9
  step 5 expects '0088' in `schema_migrations`.
- Branch `kai/tighten-0087-2026-09-12`, thread `kai-tighten-0087-2026-09-12` and this file's
  name stay as they are. Prose references to "0087" in sections 3-9 read as the tighten
  migration, i.e. 0088, until v2 rewrites them.

**R3 -- the `server_or_lapsed` CHECK leaves the tighten; the 0081 index drop gets a no-server
replacement index.** Ruled by marcus, m49207_mtz0iz0q, 23:29Z, same thread. (Marcus's message
says "record as R2"; R2 was already taken by m49203 above in eb5340b, so this is R3; numbering
flagged in my reply.) Fable overrides (Q8 in section 11). Resolves the R1 open consequence.
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
- Applied in this document: section 2 scope-note (b), step 5 last bullet, step 6, section 4
  rollback list, section 8 first bullet, section 9 dry-run item 1 and schema-read item 5,
  section 11 Q8 and the two reads. Migration filename stays 0088 (R2). Nothing built.
