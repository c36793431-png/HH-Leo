# 0086 phase 2 (step ii) — code spec

Author: kai. Branch: `kai/phase2-access-requests-2026-09-12`, off origin/main `0a493be` (the merge
of 0086, applied to prod 2026-09-12 17:30Z). Reviewer: fable. Owner: marcus. Product owner: coxwell.

Status: PASS, strikes S1..S5 CLEARED (fable m48897, 18:05Z, read against 0754de1; the
PASS-WITH-STRIKES was bus m48856..m48859, ledger v1.57). The five strikes and the non-strike
amendments (P2 comment + section 9 line, P7 per-surface split, P8 "self-serve" rendering) are
folded in below and marked "RULED". Code on sections 2, 3, 4(a), 5, 6, 7 proceeds; files 8 and 9
(provider panel, Telegram) are RELEASED by coxwell's C2 (18:02Z, marcus m48886, ledger v1.59;
section 4(c)). Fable's addendum
(marcus m48872, 17:58Z, no new strike): S5 section-10 grep proof extended to `request_id` under
the feed code; G6 repoint-all ACCEPTED as written; section 7 answer B mechanics ACCEPTED, C7 does
not gate code start; section 9 gains the P2 interval line; section 11 sentences 1-4 ruled
not-this-slice / Leo's / =S4 / tighten's, no action. Every ruling cited as
"Source X" is quoted verbatim in `docs/specs/0086-phase2-ledger-extract.md` (banked from bus
m48760..m48763). Anything below that is not a Source citation is a PROPOSAL and is marked so; a
PROPOSAL fable ruled on carries her verdict in brackets.

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
| 8 | `src/lib/feed-providers.ts` | :101-107 `listPendingRequestsForProvider`; :123-149 provider approve/reject | Provider approve = the trial-only rule (C2, section 4(c)), applied by the facade when no decision is passed; the re-point IS the facade, so this file has NO diff at HEAD. Reads stay on the facade. |
| 9 | `src/app/api/telegram/webhook/route.ts` | :45-54 `feedreq` dispatch; :142-148 callback catch | Approve-from-Telegram = the same facade default; legacy-id lookup is the facade's. The route's only diff: the two named refusals (section 4(c)) reach the admin as the callback alert text instead of "Action failed". |

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
   [RULED P2 accept; bookkeeping amendment: the second check carries a code comment naming the
   tighten file as its removal point, and section 9 gains one line so the tighten's author sees it.]
5. Inside-batch dedupe: identical `(serverRegistrationId, feedTierId)` pairs in one batch collapse
   to one item before insert (package + member overlap, Source F says Q22(c) is non-gating; this is
   the smallest safe handling).
6. Software items [RULED S3]: a `kind = 'software'` item is REFUSED in this slice with the named
   error `SoftwareRequestsNotShippedError` ("software requests ship with the software UI"); nothing
   written. The `kind` dispatch skeleton stays so the software slice adds a handler, not a
   restructure. Next slice (not this one): the Source G(c) vocabulary check (`productId` in
   `licenses.tier`'s `'trial'|'paid'|'team'|'deal'`, 0013, 0086 header note (c)) and the
   `software_request_details` insert move here when the software UI ships. No UI surface submits
   a software item today, so there is no client-visible change (C8).
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
  endsAt: Date | null,        // paid: required, > now(); trial: IGNORED, derived server-side (S4)
  invoiceRef: string | null   // required non-empty when paid, must be null when trial (Source J/K)
}
```

[RULED S4] For `decision = 'trial'` the library derives `endsAt = now() + TRIAL_DURATION_DAYS`
(`feed-tier-trials.ts:7`, 7 days) at approval time and ignores any submitted date; the free date
exists for `paid` only. Input validation before opening a transaction: `paid` requires `endsAt >
now()` and a non-empty `invoiceRef`; `trial` forbids `invoiceRef`. A trial length other than the
constant is a later slice with the `feed_tier_trials` retire (C4 notice).

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
      PROPOSAL [RULED P4 accept]: `status = 'active'` for both decisions, matching today's approval
      writer (:785 writes the `'active'` literal for trial-originated rows, comment :84-97); the read
      side is frozen for (ii) (v1.49 closing sentence). Correction from the ruling, recorded for the
      retire slice: the Subscribers tab reads `feed_tier_trials` only (v1.37), so `'trial'` on the
      row would not move that tab; it would move the Accounts page if it groups by status. Trial-ness
      on new rows is the envelope's `decision` plus `access_request_id`, not the row status, and the
      retire slice keys on that.
   e. INSERT `feed_allowlist_records` per (server, tier), shape in section 4(a).

   **software handler** [RULED S3]: in this slice the dispatch refuses `product_kind = 'software'`
   with the same named error as section 2 item 6 (`SoftwareRequestsNotShippedError`, "software
   requests ship with the software UI"); nothing written, transaction rolled back. The dispatch
   skeleton stays. Next slice note, kept here so the shape is not lost (v1.48(1): "writes a licenses
   row, no server task"): the handler will insert
   `licenses (user_id, license_key, status, expires_at, notes, feed_types, tier)` with the same
   column list as `licenses.ts:225`, on the SAME client, key from `generateLicenseKey` with the
   retry loop `licenses.ts:221`, no server row, no subscription, no allowlist record, and it must
   decide what to do with the activation side effects `licenses.ts:232-243`. None of that ships
   until a route reaches it and a test-plan step exercises it.

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
   [RULED S2(ii)] `licenses.expires_at IS NULL` refuses before the transaction opens with the named
   error `LicenseHasNoExpiryError` ("licence has no expiry; grant through the request queue with a
   date"). Fact from the checkout: `licenses.expires_at` is `timestamptz not null` (0001:57) and the
   resolver already filters `expires_at > now()`, so the guard is unreachable today; it is kept as
   ruled so the flip's preflight (zero live rows with `ends_at NULL`) never depends on that
   constraint staying. coxwell can override on the list (C6).
2. `select id, declared_ip from server_registrations where license_id = $1` (own query, same
   reason as section 2); none -> PROPOSAL [RULED P5 accept] new `NoServerForFeedGrantError` ("HH<n>
   has no registered server, so <tier> can't be granted: a grant is keyed on the server"). Same
   reason as section 2's flag: the grain is the server row.
3. One transaction: FOR UPDATE on that server row; reactivate lookup keyed on
   `(server_registration_id, feed_tier_id)` (was `(license_id, feed_tier_id)` :851); if a row
   exists, the existing reactivate branches (:855-885) run with the new key AND [RULED S2(i)] both
   set `ends_at = licence expires_at` (with `updated_at = now()`) and write the section 4(a)
   allowlist record, same as the insert branch, so a reactivated grant never carries a stale past
   `ends_at` into the flip; else `createSubscription` inside the same client with
   `serverRegistrationId` and `endsAt`.
   PROPOSAL [RULED P5 accept]: direct grant `ends_at = license.expires_at`, the rule 0086 section 4
   used to seed non-trial rows, so no live row is created with `ends_at NULL` (the flip's preflight,
   Source J read-side paragraph, needs zero such rows). No envelope row is written for a direct
   grant (`access_request_id NULL`); the ledger only mandates an envelope for trials (Source H).
4. Allowlist record per section 4(a), same as approval, on both the insert and reactivate
   branches.
`createSubscription` (:261, single caller :888) gains required `serverRegistrationId` and
`endsAt` in `CreateSubscriptionInput` and writes both columns at :272. The `providerTierId` branch
(provider-defined tiers, no `feed_tier_id`) keeps working; the live index does not apply to it.

---

## 4. Gaps the ledger does not cover: proposals for fable to rule

**(a) Allowlist-record write on approval.** Table shape is fixed by 0086:690-701:
`(server_registration_id, feed_tier_id, ip text, told_at default now(), revoked_at, pk (server,
tier, told_at))`. PROPOSAL [RULED P6 accept with S1]:
```
insert into feed_allowlist_records (server_registration_id, feed_tier_id, ip, told_at)
select $sr.id, $tier, $sr.declared_ip, now()
where not exists (select 1 from feed_allowlist_records
                  where server_registration_id = $sr.id and feed_tier_id = $tier
                    and ip = $sr.declared_ip and revoked_at is null)
```
- `ip = declared_ip` at approval time (Source G(e): the read that matters is equality against
  that column).
- `told_at = now()`: the meaning of "told" in this slice is "the row became visible on the
  provider's Accounts page" (`listSubscribersForProvider` :324-338 already renders
  `sr.declared_ip`). No message is sent to the provider by this slice.
- `told_by`: optional per Source I, column does not exist, no migration in this job. If fable wants
  it, it goes in the tighten file and this insert gains `told_by = decided_by`.
- The `not exists` guard [RULED S1]: keyed on (server, tier, ip) open, not (server, tier) open. An
  open record with the SAME ip is reused, not duplicated (a lapsed-and-re-approved grant where the
  provider was never told to revoke). An open record with a DIFFERENT ip is left as is (the vendor
  was not told to revoke it) and a new row is inserted, so a re-approval after the client changed
  `declared_ip` records the new IP; the PK's `told_at` permits both rows.
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
  decision input. RULED by coxwell, C2, 18:02Z, verbatim via marcus m48886 (ledger v1.59): "Client
  requests a feed, the feed provider, admin gets the request to approve. Feed provider or admin
  both can approve it equally both." Provider approve is ENABLED. Fable's recommendation (approve
  disabled on the vendor surface) is overruled and withdrawn (m48897). Build:
  - Telegram card (coxwell's own button): approve as `decision = 'trial'`, `ends_at = now() +
    TRIAL_DURATION_DAYS` (`feed-tier-trials.ts:7`, 7 days), ONLY when the tier is trial-eligible;
    otherwise the callback fails with "Paid approval needs an end date and invoice ref: use the
    admin queue". Accepted by fable as Source K as written (the admin deciding trial with the
    default length). Unchanged by C2.
  - Provider panel (the vendor): approve ENABLED, the same trial-only rule (7 days,
    trial-eligible tiers only; otherwise the action returns "Paid approval needs an end date and
    invoice ref: use the admin queue"); provider reject kept. A provider cannot supply
    `invoice_ref` (billing is Horizon's, manual, Source K). Whether the provider also gets the
    paid form (end date + invoice ref) is an open sub-question marcus has put to coxwell; if yes it
    is a follow-on to file 8 and the 4(d) form component, not a restart, and nothing in sections
    2-7 changes either way.
  - Mechanics: the facade's `approveFeedTierRequest(id, actionedBy, adminUrl, decision?)` applies
    the trial-only rule when called without a decision, so file 8 (which already calls it that
    way) needs no logic change; the re-point is the facade and file 8 has no diff. File 9 keeps
    the same call; the legacy-id lookup below is the facade's. The two named refusals
    (`PaidApprovalNeedsQueueError`, `PackageNeedsQueueError`) surface as the provider action's
    error string (`runAction`) and as the Telegram callback alert text.
  - Consequence (fable m48897, not a strike): a provider approval writes `decided_by` = the
    provider's `users.id`, so the queue's decider column now shows three shapes: an admin, a
    provider, or "self-serve". The section 5 facade query already carries `decided_by`; nothing to
    add beyond this sentence.
- Telegram callback ids: a pending Telegram card sent before deploy carries a LEGACY
  `feed_tier_requests.id`. `getFeedTierRequest(id)` (facade) looks up `access_requests.id = $1 or
  legacy_feed_tier_request_id = $1`; if the legacy id maps to N envelopes (a package), the Telegram
  approve refuses ("open the queue") because one button cannot make N per-line decisions.
- Queue and lists: the facade in section 5.

**(d) How `ends_at` is entered at approval.** Marked coxwell product (Source N). PROPOSAL [RULED
accept as default, coxwell's to reshape (C5), with S4 applied] for the admin approve form
(`feed-tier-request-row-actions.tsx`): radio `decision` trial|paid; date input `endsAt` and text
`invoiceRef` shown and required ONLY when paid; a trial decision shows no date (the form states
"7 days from approval"). The server action validates the same way as section 3. The invoice date
itself is not stored; `ends_at` is what the invoice bought (Source J "set by the invoice together
with `invoice_ref`").

**(e) Trial-row clock vs envelope `ends_at`.** [RULED S4, drift proposal withdrawn]
`feed-tier-trials.ts` is not edited in this slice (section 1), so `insertFeedTierTrial` keeps
computing `trial_ends_at = now() + 7 days` (`feed-tier-trials.ts:7,130`). Ruling: for `decision =
'trial'` the library derives `endsAt = now() + TRIAL_DURATION_DAYS` at approval time and ignores
any submitted date; the free date exists for paid only. So the envelope, the subscription row and
the `feed_tier_trials` row agree to within the after-commit gap (the trials insert runs after
commit, section 3), `feed-tier-trials.ts` stays untouched, and marcus's no-touch does not need
lifting. A trial length other than the constant is a later slice with the retire (C4 notice).

**(f) Which `feed_tier_requests` UI pages are repointed vs left on the old table (G6).** PROPOSAL
[RULED ACCEPTED as written, m48872]: ALL repointed in one deploy, NONE left reading the old table. Facts from `git grep` at `0a493be`:
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
with the table in the tighten. "No reader" is not a claim but the section 10 `request_id` grep
output (addendum m48872), so the tighten's DROP COLUMN cannot land on a reader this spec missed.

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
I: copied approved envelopes carry `decision NULL` with a `decided_by`; the queue must tolerate).
[RULED P8] A self-serve trial (section 7) carries `decision = 'trial'` with `decided_by NULL` and
is rendered "self-serve", not "-"; the two NULL shapes are distinct and the queue tells them
apart by which column is NULL. Ordered `created_at desc, batch_id, tier_key` so a batch's lines
sit together.

Facade (file 2): `listFeedTierRequests`, `getFeedTierRequest`, `FeedTierRequestRow` keep their
names and shape, backed by the query above, so `admin/feed-tier-requests/page.tsx:44-45`,
`admin/accounts/page.tsx:25`, `feeds/[region]/tiers/page.tsx:143`, `feed-providers.ts:104,125` need
no edit. Shape deltas: `id` is the envelope id; `tierKey` is the member tier (a legacy package
request shows as N rows, matching what 0086 section 3 copied); `status` loses `'provisioned'`
(`FEED_TIER_REQUEST_STATUSES` :17 becomes three values; page.tsx :12-17 and :38 follow); new
optional fields `decision`, `endsAt`, `invoiceRef`, `batchId`, `decidedBy`. `serverRegistered` is
always true for new rows (detail requires a server) and derived as today for copied rows.
Collision found while coding, for marcus: `src/app/feeds/[region]/tiers/page.tsx:177` compares
`r.status === "provisioned"`, which no longer type-checks once the union is three values. That
file is not declared. Until marcus rules on the one-token edit there, `FeedTierRequestStatus`
keeps `"provisioned"` as a type-only legacy member (no row carries it after 0086, the array does
not list it), so tsc stays clean without opening the undeclared file.

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
  is the v1.48 open item (Source N), now coxwell notice C7. PROPOSAL [RULED P8 accept; build
  answer A unless marcus says C7 flipped; answer B mechanics below ACCEPTED, C7 does not gate
  code start (m48872)]: keep it, and make it write Source H's form:
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
  Mover to name (S5(a)): today `startFeedTierTrial` (`feed-tier-trials.ts:156-173`) writes
  `feed_tier_trials` only and no `feed_subscriptions` row (kai's read of the checkout confirms
  fable's v1.37/Q21(b) claim), so it appears on the Subscribers tab and nowhere else; under this
  section it also writes a `feed_subscriptions` row, which the provider's Accounts page reads.
  Intended under Source H; the test plan expects it as a new visible row (section 10 prod step 9).
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

For the tighten's author (P2 bookkeeping): the second live check in section 2 step 4 and section 3
step 3(d), against the 0081 `(license_id, feed_tier_id)` key, exists only for rows the old
direct-grant code wrote between 0086 apply (2026-09-12 17:30Z) and this deploy. The tighten that
drops `feed_subscriptions_license_feed_tier_live_uidx` also deletes that check; the code comment
at the check names this section.

Interval statement (P2, addendum m48872): between this deploy and the tighten, the vendor record
set (`feed_allowlist_records`) is PARTIAL. It carries rows only for grants approved or directly
granted through the new path; the `'provisioned'` carry of legacy grants is the tighten's (section
11 item 4). The provider panel is locked per ledger section 9 in that interval (fable m48897,
marcus m48906): no provider surface presents the record set, and provider approve (C2, section
4(c)) writes through the same path without reading it. Nobody reads the allowlist set as the truth
of what a provider has been told until the tighten lands.

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
- Window-rule grep proof (S5(c)): `grep -n "license_id" src/lib/feed-subscriptions.ts
  src/lib/access-requests.ts` shows no writer setting `license_id` to NULL (no `license_id = null`
  and no insert omitting it), and every `insert into feed_subscriptions` in `src` names
  `license_id` alongside `server_registration_id`.
- `request_id` reader proof (S5, addendum m48872, marcus m48906), so the tighten's `DROP COLUMN
  feed_subscriptions.request_id` cannot land on an unfound reader. Command, run by kai on the
  branch at the C2 docs commit:
  `git grep -n request_id -- 'src/lib/feed-*.ts' src/lib/access-requests.ts src/app/feeds src/app/feed
  src/app/admin/feed-tier-requests src/components/admin/feed-tier-request-row-actions.tsx
  src/components/feeds src/app/api/telegram src/app/api/cron`. Output, 18 lines, verbatim:

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
  src/lib/feed-subscriptions.ts:300:          provider_tier_id, status, access_request_id, ends_at)
  src/lib/feed-subscriptions.ts:864: * (request_id, feed_tier_id)` against the legacy feed_tier_requests id) moved to
  src/lib/feed-subscriptions.ts:868: * fable P3), and feed_subscriptions.request_id is no longer written -- it drops with the old
  src/lib/feed-subscriptions.ts:916: * written for a direct grant (access_request_id NULL; Source H mandates one for trials only). */
  ```

  Reading of the 18: 7 are comments (:24, :321, :322, :594 and feed-subscriptions :864, :868,
  :916); 5 are `feed_tier_request_details.request_id` / `software_request_details.request_id`
  (:200, :218, :308, :521, :525); 6 are substring hits on the columns `access_request_id` (:328,
  feed-subscriptions :300) or `legacy_feed_tier_request_id` (:492, :513, :541, :600). No line
  selects, inserts or updates `feed_subscriptions.request_id`. Zero hits outside the two `src/lib`
  files. The `requestId` TypeScript identifiers carry the envelope id (`access_requests.id`).
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
   `server_registration_id` and `ends_at = licence expires_at`, `access_request_id NULL`, and one
   open allowlist row for (server, tier, declared_ip). If the grant reactivates a lapsed row
   instead, read that row by id: `ends_at = licence expires_at`, `updated_at > '<deploy ts>'`, and
   the allowlist row exists (S2(i)).
7. Post-deploy invariants, both must be 0 (`feed_subscriptions.updated_at` exists, 0071:55, so the
   second query also catches a reactivation, S2):
   `select count(*) from feed_subscriptions where server_registration_id is null and created_at >
   '<deploy ts>'`; `select count(*) from feed_subscriptions where status in ('trial','active') and
   ends_at is null and (created_at > '<deploy ts>' or updated_at > '<deploy ts>')`.
8. Read-side no-mover proof, two listings (S5(b)): (i) before and after deploy, `select id,
   <EFFECTIVE_STATUS_SQL> from feed_subscriptions ...` (the same read marcus used for the 0086
   dry-runs) returns identical rows for every row that existed before deploy; (ii) a second listing
   of rows created or updated since deploy with their computed status, so the new rows from steps
   2-6 and 9 are named movers, not surprises.
9. Self-serve trial (S5(a)): a test account with a registered server starts a trial on a
   trial-eligible tier. Envelope reads `approved / trial / decided_by NULL / decided_at set`; one
   `feed_subscriptions` row with all four columns (`server_registration_id`, `license_id`,
   `access_request_id`, `ends_at`) non-null; one open allowlist row; one `feed_tier_trials` row;
   the queue renders the decider as "self-serve"; the tier appears on the provider's Accounts page
   (EXPECTED new row, section 7 mover).
10. Telegram approve on a pending card sent before deploy (legacy id path, 4(c)) (S5(d)): marcus
   states at deploy whether any pending `feedreq` card exists; if one does, approving it from the
   card resolves the legacy id to its envelope and lands as a trial (or refuses with "use the admin
   queue" for a paid-only tier, or "open the queue" for a package); if none exists, the step reads
   "no pending card at deploy" and the path is covered by the id lookup alone. C2 answered
   (m48886); file 9 released.

Rollback of this slice is a code revert; it writes no schema and leaves `feed_tier_requests`
untouched, so the old code path works again immediately (the envelopes written meanwhile are
picked up by nothing until the re-run, and the tighten's preflight lists any legacy row without an
envelope, Source N).

---

## 11. Ledger sentences this slice does not satisfy (stated, not derived around)

Ruled (fable via m48872): 1 not-this-slice, 2 Leo's, 3 = S4, 4 tighten's. No action in this slice
beyond the section 9 interval statement.

1. Source J/K "renewal extends `ends_at` in place": no renewal write exists in main today and none
   is added here (section 3 says so). Needs its own job.
2. Source B "every `server_registrations` writer writes `user_id`": Leo's `server-registration.ts`
   :158-185, not kai's. The batch create tolerates `user_id NULL` on the server row via
   `coalesce(sr.user_id, l.user_id)` until the tighten backfill (section 2 step 2).
3. Source H "`ends_at` set by the trial length" holds for the envelope, the subscription row and
   the `feed_tier_trials` row alike under S4 (trial `ends_at` is always derived from the constant);
   the only residual gap is the after-commit gap between the transaction's `now()` and the
   best-effort trials insert, seconds at most, removed by the retire slice.
4. Source G(d) `'provisioned'` -> `feed_allowlist_records` carry is the tighten's, so between this
   deploy and the tighten the provider sees allowlist records only for grants approved through the
   new path.
