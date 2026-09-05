import type { PoolClient } from "@neondatabase/serverless";
import { pool } from "./db";
import type { FeedType } from "./licenses";
import { FEED_REGION_TYPE, FEED_REGIONS, isFeedRegion, regionForFeedType, type FeedRegion } from "./feed-tier-catalogue";

/** Bus thread provider-feed-subscriber-linkage-2026-08-29 (marcus, overnight block 2,
 * migration 0071). Joins a portal account to a provider's package and masks the
 * subscriber's identity behind a per-provider pseudonym (HH1, HH2, ...) -- a provider who
 * can see real names can approach subscribers directly at renewal and cut Horizon out.
 * The pseudonym is per (provider, subscriber) pair, not per subscriber, so two providers
 * comparing notes can't correlate their books. See 0071's migration comment for the full
 * schema rationale. */

function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

/** Postgres unique_violation. Used to tell "this insert collided with a real constraint"
 * apart from any other failure -- see upsertFeedSubscriptionForRequest below. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export type SubscriptionStatus = "trial" | "active" | "lapsed";

export interface CreateSubscriptionInput {
  providerUserId: string;
  subscriberUserId: string;
  feedTierId?: string | null;
  providerTierId?: string | null;
  status?: SubscriptionStatus;
}

export interface ProviderSubscriberRow {
  subscriptionId: string;
  pseudonym: string;
  tierName: string;
  tierKey: string | null;
  regionKey: string | null;
  status: SubscriptionStatus;
  startedAt: Date;
  serverIp: string | null;
}

/** Bus thread leo-provider-panel-package-labels-2026-09-04 (Fable ruling, ledger v1.46,
 * 81dd73c) overrules the union-of-licenses reasoning this comment used to carry. What still
 * stands: this maps a feed_tiers.region_key to the licenses.feed_types entry it corresponds to
 * (same mapping as FEED_REGION_TYPE in feed-tier-catalogue.ts, inlined here since that table has
 * no FK to licenses), for the ungated carve-outs below only -- "no mapping" (cme today) has no
 * license concept yet so it must not read as permanently inactive, and provider_tier_id rows
 * (ft.region_key is null, third-party self-serve) are never license-gated at all. What's
 * retracted is treating feed_types union across a subscriber's licenses as the entitlement test
 * for a bound row: a grant is per-server grain (one server's IP on one license -- that's what
 * the vendor allowlisted), a license id is stable across renewal (renewal is an UPDATE by id, so
 * a pinned row goes live again on its own), and feed_types is legacy -- request-to-approve is
 * the entitlement of record, not the checkbox array. This comment's own former example decides
 * against union semantics: London lapses, CME stays live, and the London row must read lapsed
 * so a human deprovisions that specific server -- union semantics would keep it active while any
 * license of the client is live, a silent revenue leak. See the license branch below (replacing
 * former step 2e0) for the shape this drives. An explicit admin lapse (status='lapsed',
 * deactivateFeedTierSubscription) still always wins regardless of license state -- it's a
 * one-way ratchet, unchanged. */
const REGION_TO_FEED_TYPE_SQL = `case ft.region_key when 'london' then 'london' when 'ny' then 'ny' when 'tokyo' then 'crypto' else null end`;

/** Bus thread feed-approve-request-creates-subscription-item3-2026-09-03 (marcus ruling):
 * a trial-originated subscription (approveFeedTierRequest -> assignFeedTierSubscription, same
 * function the admin picker uses) is written with status='active' like any other grant, so it
 * can't be told apart from a purchased one by s.status alone. Its subscriber also frequently
 * has no license carrying the region yet -- that's the point of a trial -- so without a
 * carve-out it would immediately read 'lapsed' via the license-exists check below, hiding the
 * one case item 3 exists for. feed_tier_trials is the authority instead: a row here means the
 * subscriber independently earned access to this exact tier_key regardless of what's on their
 * license, and its own trial_ends_at is when that access should stop, not the license check.
 * Once the trial ends (expired) or the subscriber buys in (converted), this stops matching and
 * falls through to the license gate below, same as any other row. Same shape as the
 * provider_tier_id and cme carve-outs above -- a case where the license-entitlement question
 * doesn't apply to this row at all. */
/** Ledger v1.46 (Fable ruling, thread leo-provider-panel-package-labels-2026-09-04): retires
 * step 2e0 and the feed_types-union branch it used to sit beside -- both collapse into this one
 * branch, pinned to s.license_id (added and backfilled by migration 0081). Per-server grain: the
 * entitlement is whichever license is bound to this row, not re-derived via the subscriber's
 * feed_types array. Carry-never-derive: no user_id cross-check against the subscriber. Both
 * liveness conjuncts (status = 'active' AND expires_at > now()) stay -- expires_at is
 * read-time-only and this is the only expiry test in the whole CASE; drop either and every row
 * here reads permanently active. Movers verified against the live 29-row table before this
 * landed: 2 rows flip lapsed->active (a bound license was live but had never carried the
 * region's feed_types tick), 0 flip active->lapsed. */
const EFFECTIVE_STATUS_SQL = `
  case
    when s.status = 'lapsed' then 'lapsed'
    when ft.region_key is null then s.status
    when ${REGION_TO_FEED_TYPE_SQL} is null then s.status
    when exists (
      select 1 from licenses l
      where l.id = s.license_id
        and l.status = 'active' and l.expires_at > now()
    ) then s.status
    when exists (
      select 1 from feed_tier_trials ftt
      where ftt.user_id = s.subscriber_user_id
        and ftt.tier_key = ft.tier_key
        and ftt.trial_status = 'active'
        and ftt.trial_ends_at > now()
    ) then s.status
    else 'lapsed'
  end
`;

/** Same branch order as EFFECTIVE_STATUS_SQL but without the feed_tier_trials branch --
 * a row that's non-lapsed ONLY because a live trial covers its tier doesn't count as a
 * Subscriber under bus thread leo-provider-panel-naming-pass-2026-09-04 (coxwell ruling:
 * "Trials tab have trials, Subscribers is live paying clients"). A row that's non-lapsed
 * for any OTHER reason (ungated region, direct license) still counts even if a trial row
 * happens to also exist for the same tier -- that grant doesn't depend on the trial. Used
 * only by getActiveSubscriberCountForProvider below; listSubscribersForProvider still uses
 * EFFECTIVE_STATUS_SQL since its own status column (including "trial") is out of scope for
 * this naming pass. */
const SUBSCRIBER_STATUS_SQL = `
  case
    when s.status = 'lapsed' then 'lapsed'
    when ft.region_key is null then s.status
    when ${REGION_TO_FEED_TYPE_SQL} is null then s.status
    when exists (
      select 1 from licenses l
      where l.id = s.license_id
        and l.status = 'active' and l.expires_at > now()
    ) then s.status
    else 'lapsed'
  end
`;

export function pseudonymLabel(seq: number): string {
  return `HH${seq}`;
}

/** Returns this provider-subscriber pair's stable seq, allocating one via a row-locked
 * counter increment on first contact. Must run inside the same open transaction as the
 * subscription insert (see createSubscription) so assignment is a side effect of the
 * subscription being created, never of it being viewed. The counter UPDATE takes a
 * row lock scoped to this provider, so two providers assigning concurrently never race;
 * two concurrent *first* subscriptions for the same (provider, subscriber) pair are
 * resolved by the final on-conflict re-select below rather than by the lock alone. */
async function assignPseudonymSeq(
  client: PoolClient,
  providerUserId: string,
  subscriberUserId: string
): Promise<number> {
  const existing = await client.query<{ seq: number }>(
    `select seq from provider_client_pseudonyms where provider_user_id = $1 and subscriber_user_id = $2`,
    [providerUserId, subscriberUserId]
  );
  if (existing.rowCount) return existing.rows[0].seq;

  await client.query(
    `insert into provider_pseudonym_counters (provider_user_id, next_seq) values ($1, 1)
     on conflict (provider_user_id) do nothing`,
    [providerUserId]
  );
  const counter = await client.query<{ seq: number }>(
    `update provider_pseudonym_counters set next_seq = next_seq + 1
     where provider_user_id = $1
     returning next_seq - 1 as seq`,
    [providerUserId]
  );
  const candidateSeq = counter.rows[0].seq;

  const inserted = await client.query(
    `insert into provider_client_pseudonyms (provider_user_id, subscriber_user_id, seq)
     values ($1, $2, $3)
     on conflict (provider_user_id, subscriber_user_id) do nothing
     returning seq`,
    [providerUserId, subscriberUserId, candidateSeq]
  );
  if (inserted.rowCount) return candidateSeq;

  // Lost the race against a concurrent first-subscription for the same pair --
  // candidateSeq was burned (a harmless gap in the sequence) and the pair's real,
  // already-committed seq belongs to whoever won.
  const authoritative = await client.query<{ seq: number }>(
    `select seq from provider_client_pseudonyms where provider_user_id = $1 and subscriber_user_id = $2`,
    [providerUserId, subscriberUserId]
  );
  return authoritative.rows[0].seq;
}

/** Creates (or reuses) the pair's pseudonym, then inserts the subscription row, all in one
 * transaction -- a crash mid-create can't leave a pseudonym allocated with no subscription,
 * or a subscription with no pseudonym. Throws if 0071 hasn't landed yet (42P01); there is
 * nowhere to write to pre-migration, unlike the read paths below which degrade instead. */
export async function createSubscription(input: CreateSubscriptionInput): Promise<string> {
  const { providerUserId, subscriberUserId, feedTierId = null, providerTierId = null, status = "trial" } = input;
  if ((feedTierId == null) === (providerTierId == null)) {
    throw new Error("Exactly one of feedTierId or providerTierId is required");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await assignPseudonymSeq(client, providerUserId, subscriberUserId);
    const result = await client.query<{ id: string }>(
      `insert into feed_subscriptions (provider_user_id, subscriber_user_id, feed_tier_id, provider_tier_id, status)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [providerUserId, subscriberUserId, feedTierId, providerTierId, status]
    );
    await client.query("commit");
    return result.rows[0].id;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/** Allocates (or reuses) this provider-subscriber pair's pseudonym without requiring a
 * feed_subscriptions row -- lets provider-scoped wrappers over OTHER tables (feed_tier_requests,
 * feed_tier_trials in lib/feed-providers.ts) mask identity with the same stable HH-label a
 * subscriber gets once they actually convert to a subscription, since the pseudonym is keyed
 * on the (provider, subscriber) pair, not on any one table. Returns null pre-migration
 * (42P01) -- callers must treat that as "no pseudonym available", never as licence to fall
 * back to the real identity. */
export async function pseudonymForSubscriber(
  providerUserId: string,
  subscriberUserId: string
): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const seq = await assignPseudonymSeq(client, providerUserId, subscriberUserId);
    await client.query("commit");
    return pseudonymLabel(seq);
  } catch (err) {
    await client.query("rollback");
    if (isMissingTable(err)) return null;
    throw err;
  } finally {
    client.release();
  }
}

/** Provider-facing subscriber list -- pseudonyms only. Never select subscriber_user_id,
 * email, or display_name here; leaking any of those into a provider-visible response
 * defeats the entire point of the pseudonym table. Degrades to an empty list pre-migration
 * (42P01) rather than a 500 on a live client-facing panel.
 *
 * server_registrations is joined on s.license_id (unique per license_id, so this can never
 * fan out a row) to surface the client's own registered server IP (coxwell, 2026-09-04:
 * "provider needs to see the IP ... he allowlists that IP on his own box"). Registered IP
 * only -- no captured_ip fallback, no mismatch/verification state; that stays admin-only
 * per the 2026-08-29 ruling. Null when the client has no server registered at all, which is
 * the true state for most of the London backfill rows, not a bug to paper over. */
export async function listSubscribersForProvider(providerUserId: string): Promise<ProviderSubscriberRow[]> {
  try {
    const result = await pool.query<{
      id: string;
      seq: number;
      tier_name: string;
      tier_key: string | null;
      region_key: string | null;
      status: SubscriptionStatus;
      started_at: Date;
      declared_ip: string | null;
    }>(
      `select s.id, p.seq, coalesce(ft.name, pt.tier_name) as tier_name, ft.tier_key, ft.region_key,
              ${EFFECTIVE_STATUS_SQL} as status, s.started_at, sr.declared_ip
       from feed_subscriptions s
       join provider_client_pseudonyms p
         on p.provider_user_id = s.provider_user_id and p.subscriber_user_id = s.subscriber_user_id
       left join feed_tiers ft on ft.id = s.feed_tier_id
       left join provider_tiers pt on pt.id = s.provider_tier_id
       left join server_registrations sr on sr.license_id = s.license_id
       where s.provider_user_id = $1
       order by p.seq`,
      [providerUserId]
    );
    return result.rows.map((row) => ({
      subscriptionId: row.id,
      pseudonym: pseudonymLabel(row.seq),
      tierName: row.tier_name,
      tierKey: row.tier_key,
      regionKey: row.region_key,
      status: row.status,
      startedAt: row.started_at,
      serverIp: row.declared_ip,
    }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Overview panel's "Subscribers" stat -- distinct subscribers with a live, non-trial grant,
 * where a Horizon-catalogue row counts only if its region is still license-entitled (see
 * SUBSCRIBER_STATUS_SQL above) as well as not explicitly lapsed and not merely trial-covered.
 * Degrades to 0 pre-migration, same rule as every other counter this panel renders. */
export async function getActiveSubscriberCountForProvider(providerUserId: string): Promise<number> {
  try {
    const result = await pool.query<{ count: string }>(
      `select count(distinct s.subscriber_user_id) as count
       from feed_subscriptions s
       left join feed_tiers ft on ft.id = s.feed_tier_id
       where s.provider_user_id = $1 and (${SUBSCRIBER_STATUS_SQL}) != 'lapsed'`,
      [providerUserId]
    );
    return Number(result.rows[0]?.count ?? 0);
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
}

/** Bus thread feed-subscription-recording-build-2026-09-03 (marcus, coxwell-authorised).
 * Records access clients actually hold via Horizon's own regional catalogue (feed_tiers) --
 * distinct from the self-onboarded provider_tiers path, which createSubscription/
 * listSubscribersForProvider already handle generically. Admin-facing only. */

export interface FeedTierPickerRow {
  id: string;
  tierKey: string;
  name: string;
  regionKey: string;
  providerUserId: string | null;
  sortOrder: number;
}

/** Picker source for /admin/users/[id] -- reads feed_tiers directly rather than the
 * app-code FEED_TIERS catalogue (feed-tier-catalogue.ts) since this control needs the
 * row's id and provider_user_id to write a subscription, and 0074 confirmed the DB name
 * and the catalogue name are already in sync. providerUserId null means the tier exists
 * in the catalogue but isn't assigned to a provider account yet (e.g. Ultra/Alpha 85 per
 * coxwell) -- still offered here, assignFeedTierSubscription rejects saving it. */
export async function listFeedTiersForAdminPicker(): Promise<FeedTierPickerRow[]> {
  const result = await pool.query<{
    id: string;
    tier_key: string;
    name: string;
    region_key: string;
    provider_user_id: string | null;
    sort_order: number;
  }>(
    `select id, tier_key, name, region_key, provider_user_id, sort_order
     from feed_tiers
     order by region_key, sort_order`
  );
  return result.rows.map((row) => ({
    id: row.id,
    tierKey: row.tier_key,
    name: row.name,
    regionKey: row.region_key,
    providerUserId: row.provider_user_id,
    sortOrder: row.sort_order,
  }));
}

export interface SubscriberFeedTierSubscription {
  subscriptionId: string;
  tierKey: string;
  tierName: string;
  regionKey: string;
  status: SubscriptionStatus;
  lapsedAt: Date | null;
}

const REGION_LABELS: Record<string, string> = { london: "London", ny: "New York", cme: "CME", tokyo: "Tokyo" };

/** The subscriber's current Horizon-catalogue (feed_tier_id-backed) subscriptions, one per
 * TIER -- deliberately excludes provider_tier_id rows, which belong to real third-party
 * providers and are never something this admin control should read, show, or touch. A region
 * can hold more than one simultaneous tier subscription (the London Base package is three
 * London tiers sold as one unit -- coxwell ruling, thread leo-region-vs-tier-subscription-key-
 * collision-2026-09-03), so the grain here is (subscriber, tier), not (subscriber, region).
 * Formerly `distinct on (ft.region_key)` collapsed to one row per region and silently hid
 * every tier but the most recently started one -- see the sibling migration/collision writeup
 * for how that lost two of HH1's three approved London tiers. */
export async function getFeedTierSubscriptionsForSubscriber(
  subscriberUserId: string
): Promise<SubscriberFeedTierSubscription[]> {
  const result = await pool.query<{
    id: string;
    tier_key: string;
    name: string;
    region_key: string;
    status: SubscriptionStatus;
    lapsed_at: Date | null;
  }>(
    `select s.id, ft.tier_key, ft.name, ft.region_key, s.status, s.lapsed_at
     from feed_subscriptions s
     join feed_tiers ft on ft.id = s.feed_tier_id
     where s.subscriber_user_id = $1
     order by ft.region_key, s.started_at desc`,
    [subscriberUserId]
  );
  return result.rows.map((row) => ({
    subscriptionId: row.id,
    tierKey: row.tier_key,
    tierName: row.name,
    regionKey: row.region_key,
    status: row.status,
    lapsedAt: row.lapsed_at,
  }));
}

/** A region with no FEED_REGION_TYPE mapping (cme today) has no licence concept at all yet,
 * so it can't be gated by entitlement -- same "ungated" treatment EFFECTIVE_STATUS_SQL above
 * gives it on the provider-facing side. A region the client already has a subscription row in
 * (any status) also stays visible even if entitlement has since lapsed, so admin can still
 * see/deactivate it rather than losing the control entirely. */
function isRegionOfferable(regionKey: string, entitledFeedTypes: Set<FeedType>, hasExistingSubscription: boolean): boolean {
  if (hasExistingSubscription) return true;
  if (!isFeedRegion(regionKey)) return true;
  const feedType = FEED_REGION_TYPE[regionKey];
  if (feedType === null) return true;
  return entitledFeedTypes.has(feedType);
}

export interface FeedAssignmentRow {
  regionKey: string;
  /** "unavailable" -- client is entitled to this region but the catalogue has no tiers for
   * it yet (tokyo today). Rendered as a disabled row naming the reason rather than hidden,
   * so the entitlement isn't silently unfulfillable-looking (Item C,
   * feed-subscription-recording-build-2026-09-03). */
  kind: "assignable" | "unavailable";
  tiers: FeedTierPickerRow[];
  /** ALL of this subscriber's subscription rows in this region, not just one -- a region can
   * hold more than one simultaneous tier (the London Base package is three London tiers sold
   * as one unit). Formerly a single nullable `subscription`; renamed and pluralized during the
   * region-to-tier-key migration (thread leo-region-vs-tier-subscription-key-collision-2026-09-03)
   * since collapsing to one silently hid every tier but the most recently started. */
  subscriptions: SubscriberFeedTierSubscription[];
  /** True when this row is only offerable because of an existing subscription row, not
   * current licence entitlement (e.g. the licence expired/downgraded after the assignment
   * was made). Never true for an already-lapsed subscription -- that's the separate
   * "Access ended" state. */
  entitlementLapsed: boolean;
}

/** Single source of truth for which regions render on /admin/users/[id]'s feed-assignment
 * block and what each one shows -- both the block's visibility (page.tsx) and its contents
 * (FeedTierSelectForm) read this same computed list, so they can't drift apart (Item A,
 * feed-subscription-recording-build-2026-09-03, marcus ruling). Lives here rather than in
 * feed-tier-select-form.tsx because that module is "use client" -- a Server Component calling
 * a function exported from a client module gets an opaque client reference back, not the
 * function, and throws at request time (incident e44fef2, root-caused 2026-09-03). This module
 * has no "use client" directive, so both the server page and the client form can import it. */
export function computeFeedAssignmentRows(
  tiers: FeedTierPickerRow[],
  subscriptions: SubscriberFeedTierSubscription[],
  entitledFeedTypes: FeedType[]
): FeedAssignmentRow[] {
  const entitled = new Set(entitledFeedTypes);
  const rows: FeedAssignmentRow[] = [];
  const seen = new Set<string>();

  const catalogueRegions = [...new Set(tiers.map((t) => t.regionKey))];
  for (const regionKey of catalogueRegions) {
    const regionSubscriptions = subscriptions.filter((s) => s.regionKey === regionKey);
    const hasExistingSubscription = regionSubscriptions.length > 0;
    if (!isRegionOfferable(regionKey, entitled, hasExistingSubscription)) continue;
    seen.add(regionKey);
    const feedType = isFeedRegion(regionKey) ? FEED_REGION_TYPE[regionKey] : null;
    const isCurrentlyEntitled = feedType === null ? true : entitled.has(feedType);
    // entitlementLapsed considers the region's most recently started row -- any one row
    // switching a lapsed license back to active re-covers every tier in the region alike, so a
    // single representative is enough to decide the banner; individual rows still render their
    // own status independently below it.
    const mostRecent = regionSubscriptions[0] ?? null;
    rows.push({
      regionKey,
      kind: "assignable",
      tiers: tiers.filter((t) => t.regionKey === regionKey),
      subscriptions: regionSubscriptions,
      entitlementLapsed: hasExistingSubscription && !isCurrentlyEntitled && mostRecent?.status !== "lapsed",
    });
  }

  // Entitled regions the catalogue has no tiers for at all (tokyo today) never surface via
  // the loop above since they have no rows in `tiers` to begin with.
  for (const feedType of entitled) {
    const regionKey = regionForFeedType(feedType);
    if (!regionKey || seen.has(regionKey)) continue;
    seen.add(regionKey);
    rows.push({ regionKey, kind: "unavailable", tiers: [], subscriptions: [], entitlementLapsed: false });
  }

  return rows.sort(
    (a, b) => FEED_REGIONS.indexOf(a.regionKey as FeedRegion) - FEED_REGIONS.indexOf(b.regionKey as FeedRegion)
  );
}

export class FeedTierNotAssignedError extends Error {
  constructor(tierName: string, regionKey: string) {
    const regionLabel = REGION_LABELS[regionKey] ?? regionKey;
    super(`${tierName} (${regionLabel}) isn't assigned to a provider account yet -- it needs a provider assigned before it can be granted`);
    this.name = "FeedTierNotAssignedError";
  }
}

export class DuplicateTierGrantError extends Error {
  constructor(tierName: string) {
    super(`${tierName} already has a live (trial/active) subscription via a different request -- refusing to create a second grant for the same tier`);
    this.name = "DuplicateTierGrantError";
  }
}

export interface FeedTierForAssignment {
  feedTierId: string;
  tierName: string;
  regionKey: string;
  providerUserId: string | null;
}

/** Shared tier lookup for both grant paths below (admin-direct and request-approval) -- one
 * query, one "unknown tier key" error, so the two paths can't drift on what "the tier" means.
 * Exported so approveFeedTierRequest (feed-tier-requests.ts) can resolve the tier's
 * feedTierId/providerUserId before opening its own transaction, without duplicating this
 * query. */
export async function getFeedTierForAssignment(tierKey: string): Promise<FeedTierForAssignment> {
  const tier = await pool.query<{ id: string; name: string; region_key: string; provider_user_id: string | null }>(
    `select id, name, region_key, provider_user_id from feed_tiers where tier_key = $1`,
    [tierKey]
  );
  if (!tier.rowCount) throw new Error(`Unknown feed tier: ${tierKey}`);
  const row = tier.rows[0];
  return { feedTierId: row.id, tierName: row.name, regionKey: row.region_key, providerUserId: row.provider_user_id };
}

/** Approval-path write -- Fable's ruling, specs/horizon-feed-provisioning-ledger-v1.md
 * section 3.3 item 1 (d108353, relayed m36289, thread leo-package-grant-fix-2026-09-04):
 * "the identity of the approval is the request; the identity of a grant is (request, tier)."
 * One approval can back N grant rows (a package tier_key expands to N member tiers via
 * expandTierKey, feed-tier-catalogue.ts), so the conflict target is the pair, not request_id
 * alone -- `on conflict (request_id, feed_tier_id)` against
 * feed_subscriptions_request_tier_uidx (migration 0079). A single-tier request is the N = 1
 * case of this same call, made once from approveFeedTierRequest's loop; there is no separate
 * "primary" vs "member" path. Replaying the same request (retry, double-click, re-approving an
 * already-approved request) reactivates the SAME N rows via their (request_id, feed_tier_id)
 * identity, never inserts new ones. The business key still carries its own partial unique index
 * scoped to live rows (subscriber_user_id, feed_tier_id) WHERE status IN ('trial','active'): if
 * a DIFFERENT request_id collides with an already-live grant for the same tier (including a
 * different member of the same package colliding with an unrelated direct grant), the insert
 * throws a Postgres unique_violation on THAT index, which this rethrows as
 * DuplicateTierGrantError -- the caller's transaction rolls back and the whole approval fails
 * loudly, no partial package grant. Must run inside the SAME transaction as the request's status
 * flip to 'approved' (caller's job) -- feed_tier_requests carries no subscription_id column
 * (dropped, migration 0080); the relation is feed_subscriptions.request_id, and "is this request
 * granted" is the request's own status column. */
export async function upsertFeedSubscriptionForRequest(
  client: PoolClient,
  args: { requestId: string; providerUserId: string; subscriberUserId: string; feedTierId: string; tierName: string }
): Promise<string> {
  const { requestId, providerUserId, subscriberUserId, feedTierId, tierName } = args;
  await assignPseudonymSeq(client, providerUserId, subscriberUserId);
  try {
    const result = await client.query<{ id: string }>(
      `insert into feed_subscriptions (provider_user_id, subscriber_user_id, feed_tier_id, status, request_id)
       values ($1, $2, $3, 'active', $4)
       on conflict (request_id, feed_tier_id) where request_id is not null and feed_tier_id is not null do update
         set status = 'active', lapsed_at = null, provider_user_id = excluded.provider_user_id, updated_at = now()
       returning id`,
      [providerUserId, subscriberUserId, feedTierId, requestId]
    );
    return result.rows[0].id;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateTierGrantError(tierName);
    throw err;
  }
}

/** Admin-facing upsert: grants a subscriber ONE specific Horizon-catalogue TIER. Idempotent --
 * re-saving the same tierKey is a no-op (reactivates if lapsed). A region can hold more than
 * one simultaneous tier subscription (the London Base package is three London tiers sold as
 * one unit -- coxwell ruling, thread leo-region-vs-tier-subscription-key-collision-2026-09-03),
 * so this never touches or moves any OTHER tier's row, including other tiers in the same
 * region -- assigning ld-gamma-19 to a client who already holds ld-beta-56 is purely an ADD.
 * (Formerly keyed the lookup on region_key and UPDATEd that region's one row in place, which
 * silently discarded every previously-granted tier in the region but the last one -- see the
 * same thread for the confirmed live data loss this caused.) An explicit tier-to-tier move
 * (e.g. a plan upgrade that should end the old tier) is two calls: assign the new tier, then
 * deactivateFeedTierSubscription the old one -- not this function's job to infer that intent.
 * Status is 'active' (not createSubscription's 'trial' default): this is a direct admin grant,
 * not the request/trial flow. Unlike upsertFeedSubscriptionForRequest above, this still upserts
 * on the business key (subscriber, tier) -- there is no request identity here to upsert on
 * instead, and idempotent re-click-to-reactivate is the desired admin UX, not an error
 * condition. Fable's "never upsert on a business key" targets the approval path specifically,
 * where a retried/duplicated REQUEST must not silently coalesce into an unrelated grant. */
export async function assignFeedTierSubscription(subscriberUserId: string, tierKey: string): Promise<void> {
  const { feedTierId, tierName, regionKey, providerUserId } = await getFeedTierForAssignment(tierKey);
  if (!providerUserId) throw new FeedTierNotAssignedError(tierName, regionKey);

  const existing = await pool.query<{ id: string; provider_user_id: string }>(
    `select id, provider_user_id from feed_subscriptions where subscriber_user_id = $1 and feed_tier_id = $2`,
    [subscriberUserId, feedTierId]
  );

  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.provider_user_id === providerUserId) {
      await pool.query(
        `update feed_subscriptions set status = 'active', lapsed_at = null, updated_at = now() where id = $1`,
        [row.id]
      );
      return;
    }
    // Same tier, different provider_user_id -- the tier's provider assignment changed since
    // this row was created (feed_tiers.provider_user_id is reassignable). Follow the tier's
    // current owner rather than leaving the row pointed at a stale provider.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await assignPseudonymSeq(client, providerUserId, subscriberUserId);
      await client.query(
        `update feed_subscriptions
         set provider_user_id = $2, status = 'active', lapsed_at = null, updated_at = now()
         where id = $1`,
        [row.id, providerUserId]
      );
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  try {
    await createSubscription({ providerUserId, subscriberUserId, feedTierId, status: "active" });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateTierGrantError(tierName);
    throw err;
  }
}

/** Ends the subscriber's Horizon-catalogue subscription for ONE specific TIER -- sets
 * status='lapsed' so it drops out of getActiveSubscriberCountForProvider and the provider's
 * Accounts list shows it as lapsed (existing behaviour, not new). Scoped to tierKey (not
 * regionKey) so ending one London tier never touches the client's other, separately-held
 * London tiers -- a region-scoped deactivate would incorrectly lapse an entire bundle when
 * only one member tier was meant to end. No-op if there's no such row or it's already lapsed. */
export async function deactivateFeedTierSubscription(subscriberUserId: string, tierKey: string): Promise<void> {
  await pool.query(
    `update feed_subscriptions s
     set status = 'lapsed', lapsed_at = now(), updated_at = now()
     from feed_tiers ft
     where s.feed_tier_id = ft.id
       and s.subscriber_user_id = $1
       and ft.tier_key = $2
       and s.status != 'lapsed'`,
    [subscriberUserId, tierKey]
  );
}
