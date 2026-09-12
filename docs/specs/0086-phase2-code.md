# 0086 phase 2 (step ii) — code spec

Author: kai. Branch: `kai/phase2-access-requests-2026-09-12`, off origin/main `0a493be` (the merge
of 0086, applied to prod 2026-09-12 17:30Z). Reviewer: fable. Owner: marcus. Product owner: coxwell.

Status: SPEC ONLY. No application code is written until fable PASSes this document. Every ruling
cited as "Source X" is quoted verbatim in `docs/specs/0086-phase2-ledger-extract.md` (banked from
bus m48760..m48763). Anything below that is not a Source citation is a PROPOSAL and is marked so.

Conventions: line anchors are at origin/main `0a493be`. "The primitive" means Source D's
transaction shape: `SELECT ... FOR UPDATE` on the `server_registrations` row, then the pending
check, then the live-index check, then the insert, all in one transaction, any failure rolls the
whole thing back.

---

## 1. Files to touch (declared before touching)

Kai's files. Marcus rules on collisions with Leo before any of these are opened.

| # | File | Anchor at 0a493be | Change |
|---|------|-------------------|--------|
| 1 | `src/lib/access-requests.ts` | NEW | Envelope + detail library: create batch, approve, reject, self-serve trial, list. Owns the primitive. |
| 2 | `src/lib/feed-tier-requests.ts` | :107-129 `createFeedTierRequest` (insert :109); :157-170 `actionRequest` (update :164); :231-285 `approveFeedTierRequest` (update :263); :287-294 `rejectFeedTierRequest`; :82-97 `SELECT_BASE`; :131-155 readers | Stops writing `feed_tier_requests`. Becomes a compatibility facade over `access-requests.ts` so existing callers keep their signatures (section 5). |
| 3 | `src/lib/feed-subscriptions.ts` | :261-285 `createSubscription` (insert :272); :776-797 `upsertFeedSubscriptionForRequest` (insert :784); :841-893 `assignFeedTierSubscription`; :33-45 `CreateSubscriptionInput`; :27 `isUniqueViolation`; :214-255 `assignPseudonymSeq` | Both inserts gain `server_registration_id`, `ends_at`, and (approval) `access_request_id`. Admin direct grant goes through the primitive. `assignPseudonymSeq` and `isUniqueViolation` get exported for the new library. |
| 4 | `src/app/feeds/actions.ts` | :38-77 `submitFeedTierRequestAction`; :87-116 `startFeedTierTrialAction` | Request Access submits a batch; self-serve trial writes the pre-approved envelope (section 7). |
| 5 | `src/app/admin/feed-tier-requests/actions.ts` | :15-25 `approveFeedTierRequestAction` | Approve reads `decision`, `endsAt`, `invoiceRef` from the form. |
| 6 | `src/components/admin/feed-tier-request-row-actions.tsx` | :23-27 approve `FormData` | Approve form gains the three fields (section 4(d)). |
| 7 | `src/app/admin/feed-tier-requests/page.tsx` | :3-6 imports; :12-17 `STATUS_STYLES`; :38-55 status filter + stats | Drop the `provisioned` filter/style (status vocabulary is now `pending|approved|rejected`, Source G(d)). Read stays on the facade. |
| 8 | `src/lib/feed-providers.ts` | :101-107 `listPendingRequestsForProvider`; :123-149 provider approve/reject | Provider approve passes a decision (section 4(c)); reads stay on the facade. |
| 9 | `src/app/api/telegram/webhook/route.ts` | :45-54 `feedreq` dispatch | Approve-from-Telegram rule (section 4(c)); id lookup tolerates legacy ids. |

NOT touched by kai (stated so marcus can hold them):
- `src/lib/server-registration.ts` :145-202 `saveServerRegistration` (inserts :158-185): Leo's `/account/servers` follow-up writes `user_id` (Source A, owner split in Source N).
- `src/lib/feed-subscriptions.ts` :108-127 `EFFECTIVE_STATUS_SQL` and :138-150 `SUBSCRIBER_STATUS_SQL`: unchanged (section 8).
- `src/lib/feed-tier-trials.ts` and the `feed_tier_trials` table: not edited, not retired (marcus part 2 rule; Source H). The existing `insertFeedTierTrial` is called as-is (section 7, gap 4(e)).
- `src/app/api/cron/expire-trials/route.ts`, `src/app/feed/dashboard/active-users/page.tsx`: still read `feed_tier_trials`, unchanged (Source H).
- `src/app/feeds/[region]/tiers/page.tsx` :143, `src/app/admin/accounts/page.tsx` :25, `src/app/feed/dashboard/users/actions.ts`: callers of the facade; no edit needed if the facade keeps its return shape (section 5). Listed so marcus knows they are readers of the cut-over data.
- `db/migrations/*`: no migration in this job. `feed_allowlist_records.told_by` (Source I, optional) is NOT added here; see 4(a).

---

## 2. Request creation (Sources D, E, F)

Entry: `createAccessRequestBatch(input)` in `access-requests.ts`.

```
input = {
  userId: string,
  items: Array<
    | { kind: 'feed_tier', serverRegistrationId: string, feedTierId: string }
    | { kind: 'software',  productId: string }
  >
}
returns { batchId: string, requestIds: string[] }
```

Caller mapping from today's form (`feeds/actions.ts:38-77`): the modal still posts one
`(region, tierKey, licenseId)`. The action resolves `licenseId -> server_registrations.id` (0031:
`unique (license_id)`, so at most one row) with the library's own
`select id from server_registrations where license_id = $1` in `access-requests.ts`; the
`ServerRegistration` type in Leo's `server-registration.ts` exposes no `id` and that file is not
touched. It then expands `tierKey` with `expandTierKey`
(`feed-tier-catalogue.ts:63`) so a package key becomes N items in ONE batch (Source F: a package
request is N envelopes sharing `batch_id`; 0086 section 3 copied legacy packages the same way).
A single tier is a batch of one (Source F: "one code path").

PROPOSAL, behaviour change to flag: a licence with no `server_registrations` row can no longer be
submitted. Today `feeds/actions.ts:58-66` allows it (R6 "binding unconfirmed"). Under 0086
`feed_tier_request_details.server_registration_id` is `NOT NULL` (0086:414), so there is nothing to
write. The action returns "Register a server for this licence before requesting access". Q25
(Source N) already says the no-server clients must register first.

Transaction, in order, on one `PoolClient`:

1. `begin`.
2. Distinct `serverRegistrationId`s in the batch, sorted (stable lock order so two concurrent
   batches on the same two servers cannot deadlock). For each:
   `select id, user_id, license_id, declared_ip from server_registrations where id = $1 for update`.
   Ownership: `coalesce(sr.user_id, l.user_id) = input.userId` (join `licenses l on l.id =
   sr.license_id`). The coalesce is the window rule (Source B): a row Leo's follow-up has not yet
   rewritten may carry `user_id NULL` until the tighten's re-run backfill. Not found or not owned
   throws; nothing written.
3. Pending check, per feed item:
   `select 1 from feed_tier_request_details d join access_requests a on a.id = d.request_id
    where d.server_registration_id = $1 and d.feed_tier_id = $2 and a.status = 'pending'`.
   PROPOSAL (conservative default, Q22(c) is coxwell's, flagged): a hit REJECTS the whole batch with
   `DuplicatePendingRequestError` ("<tier> is already requested for this server"). Rationale:
   Source D calls a pending duplicate a nuisance not a hazard, so either answer is safe; rejecting
   keeps the queue one row per (server, tier) and matches what the tiers page already shows the
   client (the "Requested" pill). Flip to allow is a one-line change if coxwell says so.
4. Live check, per feed item, against the new live index key (0086:657-659):
   `select 1 from feed_subscriptions where server_registration_id = $1 and feed_tier_id = $2
    and status in ('trial','active')`.
   PROPOSAL, window belt-and-braces: ALSO check the 0081 key while that index still exists
   (`license_id = sr.license_id and feed_tier_id = $2 and status in ('trial','active')`), because a
   row the old direct-grant code wrote between 0086 apply and this deploy has
   `server_registration_id NULL` and would be invisible to the first check. Drops with the tighten.
   A hit throws `DuplicateTierGrantError` (existing class, `feed-subscriptions.ts:670`).
5. Inside-batch dedupe: identical `(serverRegistrationId, feedTierId)` pairs in one batch collapse
   to one item before insert (package + member overlap, Source F says Q22(c) is non-gating; this is
   the smallest safe handling).
6. Software item validation (Source G(c)): `productId` must be one of `licenses.tier`'s vocabulary
   (`'trial'|'paid'|'team'|'deal'`, 0013) per 0086 header note (c). Otherwise throw; nothing
   written. NOTE: no UI surface submits a software item in this slice; the library accepts it so
   the approval handler in section 3 has a defined input.
7. `batchId = crypto.randomUUID()` once per call (`batch_id NOT NULL`, Source F). For each item:
   `insert into access_requests (user_id, product_kind, batch_id) values ($1, $2, $3) returning id`
   then `insert into feed_tier_request_details (request_id, server_registration_id, feed_tier_id)`
   or `insert into software_request_details (request_id, product_id)`. Envelope status defaults to
   `'pending'` (0086:391). `decision`, `ends_at`, `invoice_ref`, `reason`, `decided_*`,
   `legacy_feed_tier_request_id` stay NULL.
8. `commit`. Any throw anywhere above: `rollback`, rethrow, nothing written (Source F "fails loudly
   and writes nothing").

After commit (outside the transaction, best-effort, never fails the action): the existing
`notifyFeedTierRequestSubmitted` admin ping, once per batch, listing the N tiers.

NO write to `feed_tier_requests` from this path (Source A: "code rule from phase 2 on").

---

## 3. Approval (Sources C, D, J, K, L)

COMMERCIAL FACTS (coxwell's product decisions, recorded in the ledger v1.48 header, Source K, and
v1.47, Source J; not reopened here): no checkout; admin decides trial vs paid per request; approval
writes `ends_at` (+ `invoice_ref` when paid); renewal extends `ends_at` in place.

Entry: `approveAccessRequest(input)` in `access-requests.ts`.

```
input = {
  requestId: string,          // ONE envelope; approval is per line, never per batch (Source F)
  decidedBy: string,          // users.id
  decision: 'trial' | 'paid',
  endsAt: Date,
  invoiceRef: string | null   // required non-empty when paid, must be null when trial (Source J/K)
}
```

Input validation before opening a transaction: `endsAt > now()`; `paid` requires `invoiceRef`;
`trial` forbids it.

Transaction, in order, on one `PoolClient`:

1. `begin`.
2. `select * from access_requests where id = $1 for update`. Must be `status = 'pending'`.
   PROPOSAL, flagged: an already-approved envelope throws `RequestAlreadyDecidedError` instead of
   replaying. Today's path replays via `on conflict (request_id, feed_tier_id)` (:786). Under the
   envelope, the FOR UPDATE + status check makes a double-click fail cleanly with "already
   approved" and never inserts twice; replay-to-reactivate is not needed because a lapsed grant is
   re-requested (new envelope) or renewed (`ends_at` extended in place, Source J), not re-approved.
3. Dispatch on `product_kind` (Source E).

   **feed_tier handler:**
   a. Read the detail row. `select id, user_id, license_id, declared_ip from server_registrations
      where id = detail.server_registration_id for update` (the primitive, Source D: "direct grant
      and approval both go through the server-grain primitive").
   b. Resolve the tier: `select id, name, region_key, provider_user_id from feed_tiers where id =
      detail.feed_tier_id`; `provider_user_id NULL` throws `FeedTierNotAssignedError` (existing,
      :662), same as today's :243-244.
   c. `assignPseudonymSeq(client, providerUserId, envelope.user_id)` (existing, :214, exported).
   d. INSERT `feed_subscriptions`, plain insert, NO `on conflict`:
      ```
      insert into feed_subscriptions
        (provider_user_id, subscriber_user_id, license_id, server_registration_id, feed_tier_id,
         status, access_request_id, ends_at)
      values ($provider, $subscriber, $sr.license_id, $sr.id, $tier, 'active', $envelope.id, $endsAt)
      returning id
      ```
      `license_id` is written from the server row (window rule, Source B). `access_request_id` =
      the envelope id (Source C). `ends_at` copied from the decision (Source K). `request_id`
      stays NULL (drops with the old table). A 23505 on
      `feed_subscriptions_server_feed_tier_live_uidx` (or on the 0081 index while it exists) is
      rethrown as `DuplicateTierGrantError` and rolls back the whole transaction (Source L).
      PROPOSAL, flagged: `status = 'active'` for both decisions, matching today's approval writer
      (:785 writes the `'active'` literal for trial-originated rows, comment :84-97). The trial-ness
      lives on the envelope's `decision` and the row's `ends_at`; writing `'trial'` instead would
      move provider Subscriber counts, which is a read-side change this slice does not make.
   e. INSERT `feed_allowlist_records` per (server, tier), shape in section 4(a).

   **software handler** (v1.48(1): "writes a licenses row, no server task"):
   ```
   insert into licenses (user_id, license_key, status, expires_at, notes, feed_types, tier)
   values ($envelope.user_id, $generatedKey, 'active', $endsAt, 'access_request ' || $envelope.id,
           '{}', $product_id)
   ```
   Same column list as `licenses.ts:225`, on the SAME client so "no partial success" holds; key
   generation reuses `generateLicenseKey` with the retry loop `licenses.ts:221`. No server row, no
   subscription, no allowlist record. The activation/payment side effects `licenses.ts:232-243`
   are NOT fired from here in this slice (flagged: nothing reaches this handler from a route yet,
   see section 2 item 6; wiring notifications is the slice that adds the software UI).

4. Envelope update:
   `update access_requests set status = 'approved', decision = $2, ends_at = $3, invoice_ref = $4,
    decided_by = $5, decided_at = now(), reason = null where id = $1`.
5. `commit`. Any throw: `rollback`, rethrow. No partial success (Source L).

After commit, best-effort (never fails the approval, same as today :278-283 and :184-209):
- client DM "Feed access approved".
- If `decision = 'trial'` and the tier is trial-eligible (`isTrialEligibleTier`), write the
  `feed_tier_trials` row via the existing `insertFeedTierTrial` (unchanged, its own 7-day clock;
  gap 4(e)). Kept because `EFFECTIVE_STATUS_SQL` branch (4), the expire-trials cron and the
  provider Trials tab still read that table (Source H: not retired in this slice).

Renewal ("extends `ends_at` in place", Source J) is NOT in this slice; no renewal write exists in
main today and none is added. Stated so the spec is not read as covering it.

**Admin direct grant** (`feed-subscriptions.ts:841-893`, insert at :272; Source N: "belongs with
Kai's approval path"). `assignFeedTierSubscription(subscriberUserId, tierKey)` keeps its signature
(caller `admin/users/actions.ts:152`) and becomes:
1. Resolve the single active licence as today (:845-848, both refusal errors unchanged).
2. `select id, declared_ip from server_registrations where license_id = $1` (own query, same
   reason as section 2); none -> PROPOSAL new `NoServerForFeedGrantError` ("HH<n>
   has no registered server, so <tier> can't be granted: a grant is keyed on the server"). Same
   reason as section 2's flag: the grain is the server row.
3. One transaction: FOR UPDATE on that server row; reactivate lookup keyed on
   `(server_registration_id, feed_tier_id)` (was `(license_id, feed_tier_id)` :851); if a row
   exists, the existing reactivate branches (:855-885) run unchanged apart from the key; else
   `createSubscription` inside the same client with `serverRegistrationId` and `endsAt`.
   PROPOSAL, flagged: direct grant `ends_at = license.expires_at`, the rule 0086 section 4 used to
   seed non-trial rows, so no live row is created with `ends_at NULL` (the flip's preflight,
   Source J read-side paragraph, needs zero such rows). No envelope row is written for a direct
   grant (`access_request_id NULL`); the ledger only mandates an envelope for trials (Source H).
4. Allowlist record per section 4(a), same as approval.
`createSubscription` (:261, single caller :888) gains required `serverRegistrationId` and
`endsAt` in `CreateSubscriptionInput` and writes both columns at :272. The `providerTierId` branch
(provider-defined tiers, no `feed_tier_id`) keeps working; the live index does not apply to it.

---

## 4. Gaps the ledger does not cover: proposals for fable to rule

**(a) Allowlist-record write on approval.** Table shape is fixed by 0086:690-701:
`(server_registration_id, feed_tier_id, ip text, told_at default now(), revoked_at, pk (server,
tier, told_at))`. PROPOSAL:
```
insert into feed_allowlist_records (server_registration_id, feed_tier_id, ip, told_at)
select $sr.id, $tier, $sr.declared_ip, now()
where not exists (select 1 from feed_allowlist_records
                  where server_registration_id = $sr.id and feed_tier_id = $tier
                    and revoked_at is null)
```
- `ip = declared_ip` at approval time (Source G(e): the read that matters is equality against
  that column).
- `told_at = now()`: the meaning of "told" in this slice is "the row became visible on the
  provider's Accounts page" (`listSubscribersForProvider` :324-338 already renders
  `sr.declared_ip`). No message is sent to the provider by this slice.
- `told_by`: optional per Source I, column does not exist, no migration in this job. If fable wants
  it, it goes in the tighten file and this insert gains `told_by = decided_by`.
- The `not exists` guard: an open record for the same (server, tier) is reused, not duplicated
  (e.g. a lapsed-and-re-approved grant where the provider was never told to revoke). Flagged: the
  alternative is always-insert and let the PK's `told_at` distinguish them.
- `revoked_at` is NEVER written by this slice.

**(b) Provider-task shape.** "Stateful cancel-on-reactivate" is marcus's Q2 wording, not ledger
text (Source J flag). PROPOSAL: no provider-task table and no provider-facing to-do in this slice.
The allowlist record IS the state: open (`revoked_at NULL`) means the provider holds this IP for
this tier. A later slice adds (1) the revoke write when a grant lapses, and (2) a provider list of
open records whose subscription is no longer live. Nothing here forecloses that.

**(c) API/route surface.** PROPOSAL: no new REST routes. The surface stays the existing server
actions and Telegram callback, re-pointed:
- Request Access: `submitFeedTierRequestAction` (`feeds/actions.ts:38`) -> `createAccessRequestBatch`.
- Admin queue approve/reject: `admin/feed-tier-requests/actions.ts:15,27` -> `approveAccessRequest`
  / `rejectAccessRequest`; approve form gains `decision`, `endsAt`, `invoiceRef`.
- Provider approve (`feed-providers.ts:133`) and Telegram approve (`webhook/route.ts:48`) have no
  decision input. PROPOSAL, marked coxwell product: both approve as `decision = 'trial'`,
  `ends_at = now() + TRIAL_DURATION_DAYS` (`feed-tier-trials.ts:7`, 7 days), ONLY when the tier is
  trial-eligible; otherwise the action fails with "Paid approval needs an end date and invoice ref:
  use the admin queue". A provider cannot supply `invoice_ref` (billing is Horizon's, manual,
  Source K). Alternative if coxwell prefers: disable approve on both surfaces, keep reject.
- Telegram callback ids: a pending Telegram card sent before deploy carries a LEGACY
  `feed_tier_requests.id`. `getFeedTierRequest(id)` (facade) looks up `access_requests.id = $1 or
  legacy_feed_tier_request_id = $1`; if the legacy id maps to N envelopes (a package), the Telegram
  approve refuses ("open the queue") because one button cannot make N per-line decisions.
- Queue and lists: the facade in section 5.

**(d) How `ends_at` is entered at approval.** Marked coxwell product (Source N). PROPOSAL for the
admin approve form (`feed-tier-request-row-actions.tsx`): radio `decision` trial|paid; date input
`endsAt`, prefilled `today + TRIAL_DURATION_DAYS` when trial, empty when paid; text `invoiceRef`,
shown and required only when paid. The server action validates the same way as section 3. The
invoice date itself is not stored; `ends_at` is what the invoice bought (Source J "set by the
invoice together with `invoice_ref`").

**(e) Trial-row clock vs envelope `ends_at`.** `feed-tier-trials.ts` is not edited in this slice
(section 1), so `insertFeedTierTrial` keeps computing `trial_ends_at = now() + 7 days`
(`feed-tier-trials.ts:7,130`). When an admin approves a trial with the default end date the two
clocks agree to the second; when the admin picks another date, the envelope and subscription say
one thing and the `feed_tier_trials` row (read by `EFFECTIVE_STATUS_SQL` branch (4) and the
expire-trials cron) says 7 days. PROPOSAL: accept the drift in this slice and document it; the
retire slice (Source H: "each live trial's end is carried onto its `feed_subscriptions.ends_at`
first") removes it. Alternative, if fable prefers exactness now: marcus lifts the no-touch for a
one-line optional `trialEndsAt` parameter on `insertFeedTierTrial`, or the admin form clamps a
trial decision's `endsAt` to the 7-day default (then only paid decisions have a free date).

**(f) Which `feed_tier_requests` UI pages are repointed vs left on the old table (G6).** PROPOSAL:
ALL repointed in one deploy, NONE left reading the old table. Facts from `git grep` at `0a493be`:
- The only SQL touching `feed_tier_requests` in `src` is `feed-tier-requests.ts` (:87 `SELECT_BASE`,
  :109 insert, :164 update, :263 update).
- Every UI reader goes through that module's `listFeedTierRequests` / `getFeedTierRequest`:
  `admin/feed-tier-requests/page.tsx` :44-45, `admin/accounts/page.tsx` :25,
  `feeds/[region]/tiers/page.tsx` :143, `feed-providers.ts` :104 and :125 (behind
  `/feed/dashboard/users` and the type in `feed/dashboard/page.tsx` :22), telegram webhook :47.
- `EFFECTIVE_STATUS_SQL` (:108-150) has no reference to the table.
So repointing the facade (section 5) cuts every page over at once; leaving any page on the old table
would show it a queue that stops receiving writes at the same deploy. After this slice, grep for
`feed_tier_requests` in `src` returns 0 SQL lines (section 10 proof), which is how "phase-2 code must
not depend on `feed_tier_requests` existing" is met. The one remaining schema tie is
`feed_subscriptions.request_id` (FK to the old table, 0078): the :784 insert stops writing it and the
`on conflict (request_id, feed_tier_id)` clause at :786 goes; no reader in `src` selects it. It drops
with the table in the tighten.

---

## 5. Queue read (Sources E, I)

`listAccessRequests({ status?, userId?, productKind? })` in `access-requests.ts` reads the ENVELOPE
for status/decision (Source E: "the admin queue reads the envelope alone") and LEFT JOINs the
detail tables only for display columns:
```
select a.id, a.user_id, a.product_kind, a.batch_id, a.status, a.decision, a.ends_at,
       a.invoice_ref, a.reason, a.decided_by, a.decided_at, a.legacy_feed_tier_request_id,
       a.created_at,
       u.display_name, u.email, u.telegram_user_id,
       d.server_registration_id, d.feed_tier_id, ft.tier_key, ft.region_key,
       sr.server_name, sr.declared_ip, sr.license_id, l.license_key,
       s.product_id
from access_requests a
join users u on u.id = a.user_id
left join feed_tier_request_details d on d.request_id = a.id
left join feed_tiers ft on ft.id = d.feed_tier_id
left join server_registrations sr on sr.id = d.server_registration_id
left join licenses l on l.id = sr.license_id
left join software_request_details s on s.request_id = a.id
```
No join to `feed_tier_requests`, no join to `feed_subscriptions`, no status derived from anything
but `a.status`. `decision` is typed `'trial' | 'paid' | null` and NULL is rendered as "-" (Source
I: copied approved envelopes carry `decision NULL`; the queue must tolerate). Ordered
`created_at desc, batch_id, tier_key` so a batch's lines sit together.

Facade (file 2): `listFeedTierRequests`, `getFeedTierRequest`, `FeedTierRequestRow` keep their
names and shape, backed by the query above, so `admin/feed-tier-requests/page.tsx:44-45`,
`admin/accounts/page.tsx:25`, `feeds/[region]/tiers/page.tsx:143`, `feed-providers.ts:104,125` need
no edit. Shape deltas: `id` is the envelope id; `tierKey` is the member tier (a legacy package
request shows as N rows, matching what 0086 section 3 copied); `status` loses `'provisioned'`
(`FEED_TIER_REQUEST_STATUSES` :17 becomes three values; page.tsx :12-17 and :38 follow); new
optional fields `decision`, `endsAt`, `invoiceRef`, `batchId`. `serverRegistered` is always true
for new rows (detail requires a server) and derived as today for copied rows.

---

## 6. Rejection (Source G(b))

`rejectAccessRequest({ requestId, decidedBy, reason })`: one statement in one transaction,
`select ... for update`, must be `pending`, then
`update access_requests set status = 'rejected', reason = $2, decided_by = $3, decided_at = now()
 where id = $1`. `reason` is the admin's decision reason (Source G(b)); `null` allowed (Telegram
writes `'declined via Telegram'` as today :52). Per line, not per batch. Client DM after commit
as today (:289-292). The old `actionRequest` (:157-170) is deleted with its `feed_tier_requests`
update.

---

## 7. Trials (Source H)

- Every trial is an `access_requests` row with `decision = 'trial'` (Source H). Admin-side that is
  section 3 with `decision = 'trial'`.
- Self-serve button (`startFeedTierTrialAction`, `feeds/actions.ts:87-116`): whether it survives
  is the v1.48 open item (Source N), unruled. PROPOSAL: keep it, and make it write Source H's form:
  `createAccessRequestBatch` for the one tier, then, in the SAME transaction, the section 3 feed
  handler with `decision = 'trial'`, `endsAt = now() + TRIAL_DURATION_DAYS`, `invoiceRef = null`,
  `decided_by = NULL` (column is nullable, 0086:396; there is no admin; flagged), `decided_at =
  now()`. So a self-serve trial is an envelope already `approved` with its subscription row,
  allowlist record and `ends_at` set by the trial length, and the queue shows it as decided.
  Implemented as `startSelfServeTrial(input)` in `access-requests.ts` composing the two internal
  functions on one client.
  Behaviour change to flag: today the button needs only an active licence (:101-102); under the
  server grain it needs that licence's server row, else "Register a server first".
  Eligibility (`isTrialEligibleTier`) and one-trial-per-(user, tier) (`feed_tier_trials_user_tier_uidx`,
  0036) are checked BEFORE the transaction opens so the existing errors surface unchanged.
- Both answers to the v1.48 open item are designed for (marcus part 2: "the schema does not wait
  on coxwell's line"). The bullet above is answer A (button survives). Answer B (button retired):
  `startFeedTierTrialAction` is deleted and `components/feeds/trial-cta-control.tsx` (:4, :75, its
  only caller) loses the start button; the client's only entry is Request Access and the admin
  marks `decision = 'trial'` in the queue (section 3). `trial-cta-control.tsx` is NOT on the
  section 1 declared list; if coxwell picks B, kai re-declares it to marcus before opening it.
  Schema and library (`access-requests.ts`) are identical under A and B; only the action and the
  CTA component differ.
- `feed_tier_trials` is NOT retired and `feed-tier-trials.ts` is not edited. Both trial entry
  points still write the table (best-effort, after commit) via the existing `insertFeedTierTrial`,
  whose 7-day clock is independent of the envelope's `ends_at` (gap 4(e)). Its readers (branch (4)
  of `EFFECTIVE_STATUS_SQL`, expire-trials cron, provider Trials tab, `markFeedTierTrialConverted`)
  are untouched.

---

## 8. Read side: nothing changes

NOTHING in `EFFECTIVE_STATUS_SQL` (`feed-subscriptions.ts:108-127`) or `SUBSCRIBER_STATUS_SQL`
(:138-150) changes in this slice. Source J read-side paragraph, v1.49 closing sentence: the flip is
coxwell's separate word. In particular: the licence-gate branch stays, the trial branch stays,
no `ends_at` test is added, no `licenses` join is removed. The new columns this slice writes
(`server_registration_id`, `ends_at`, `access_request_id`) are written for the flip to read
later; no reader in this slice depends on them except the duplicate checks in sections 2 and 3.

---

## 9. Cutover re-run predicate (iv): reference only

Source M: the tighten/cutover file that re-runs 0086 section 3 extends the skip predicate with
`not exists (select 1 from access_requests where legacy_feed_tier_request_id = ftr.id)`. That file
is not this job. This spec only guarantees the inputs it relies on: new code never writes
`feed_tier_requests`, never writes `legacy_feed_tier_request_id`, and sets `decided_at` on every
decision so the section 3 `WHERE access_requests.decided_at IS NULL` guard (0086:488) protects
new-path decisions on the re-run.

---

## 10. Test plan

No non-prod database exists. Two layers.

**Local, before the branch is handed over (kai runs, output pasted to marcus):**
- `npx tsc --noEmit` clean.
- `npm run lint` clean.
- Grep proofs: `grep -rn -e "insert into feed_tier_requests" -e "update feed_tier_requests" src`
  returns 0 lines; `grep -rn "insert into feed_subscriptions" src` returns exactly the two inserts and each
  names `server_registration_id`; `grep -n "EFFECTIVE_STATUS_SQL = " src/lib/feed-subscriptions.ts`
  shows the block unchanged against `0a493be` (`git diff 0a493be -- src/lib/feed-subscriptions.ts`
  has no hunk inside :108-150).
- Pure-function checks kai can run with `npx tsx` if marcus allows it (node is refused on this
  box today): input validation of `approveAccessRequest` (paid without invoice, trial with
  invoice, `endsAt` in the past) and inside-batch dedupe. Otherwise these are reviewed, not run.

**Prod, by marcus's reads after deploy (SQL only, all SELECT):**
1. Baseline before the first new request: `select count(*) from feed_tier_requests` and
   `select count(*) from access_requests`. After every step below the first count is unchanged.
2. coxwell (or a test account) submits Request Access for a package tier on a registered server:
   `select id, batch_id, product_kind, status, decision from access_requests order by created_at
   desc limit 5` shows N rows, one `batch_id`, `status = 'pending'`, `decision NULL`;
   `select * from feed_tier_request_details where request_id in (...)` shows N rows with the
   chosen server. Submitting the same tier again returns the duplicate error and the counts do not
   move.
3. Admin approves one line as paid with an invoice ref and an end date: the envelope reads
   `approved / paid / ends_at / invoice_ref / decided_by / decided_at`; `select
   server_registration_id, license_id, access_request_id, ends_at, status, request_id from
   feed_subscriptions where access_request_id = '<id>'` shows one row, all four columns non-null,
   `request_id NULL`; `select * from feed_allowlist_records where server_registration_id = '<sr>'`
   shows one open row with `ip = declared_ip`. The other lines of the batch are still `pending`.
4. Admin approves the same line again: error "already approved"; row counts unchanged.
5. Admin rejects another line with a reason: envelope `rejected`, `reason` stored, no subscription
   row for it.
6. Admin direct grant on a user with one licence and a server: new `feed_subscriptions` row has
   `server_registration_id` and `ends_at = licence expires_at`, `access_request_id NULL`.
7. Post-deploy invariants, both must be 0:
   `select count(*) from feed_subscriptions where server_registration_id is null and created_at >
   '<deploy ts>'`; `select count(*) from feed_subscriptions where status in ('trial','active') and
   ends_at is null and created_at > '<deploy ts>'`.
8. Read-side no-mover proof: before and after deploy, `select id, <EFFECTIVE_STATUS_SQL> from
   feed_subscriptions ...` (the same read marcus used for the 0086 dry-runs) returns identical
   rows for every row that existed before deploy.

Rollback of this slice is a code revert; it writes no schema and leaves `feed_tier_requests`
untouched, so the old code path works again immediately (the envelopes written meanwhile are
picked up by nothing until the re-run, and the tighten's preflight lists any legacy row without an
envelope, Source N).

---

## 11. Ledger sentences this slice does not satisfy (stated, not derived around)

1. Source J/K "renewal extends `ends_at` in place": no renewal write exists in main today and none
   is added here (section 3 says so). Needs its own job.
2. Source B "every `server_registrations` writer writes `user_id`": Leo's `server-registration.ts`
   :158-185, not kai's. The batch create tolerates `user_id NULL` on the server row via
   `coalesce(sr.user_id, l.user_id)` until the tighten backfill (section 2 step 2).
3. Source H "`ends_at` set by the trial length" holds for the envelope and the subscription row, but
   the `feed_tier_trials` row keeps its own 7-day clock because `feed-tier-trials.ts` is untouched
   by marcus's rule; drift only when an admin picks a non-default trial date (gap 4(e), three
   options listed there).
4. Source G(d) `'provisioned'` -> `feed_allowlist_records` carry is the tighten's, so between this
   deploy and the tighten the provider sees allowlist records only for grants approved through the
   new path.
