import type { PoolClient } from "@neondatabase/serverless";
import { pool } from "./db";

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
  status: SubscriptionStatus;
  startedAt: Date;
}

/** Bus thread feed-subscription-recording-build-2026-09-03 (marcus ruling, 2026-09-03,
 * no coxwell/migration needed): a Horizon-catalogue (feed_tier_id-backed) subscription's
 * true entitlement is the union of feed_types across ALL of the subscriber's currently
 * active licenses, not a single linked license_id -- a client can hold two active licenses
 * (e.g. London lapses, CME stays active) and adding license_id would wrongly pin the
 * subscription to one of them. So this maps a feed_tiers.region_key to the licenses.feed_types
 * entry it corresponds to (same mapping as FEED_REGION_TYPE in feed-tier-catalogue.ts, inlined
 * here since that table has no FK to licenses) and treats "no mapping" (cme today) as
 * ungated -- there's no license concept for that region yet, so it must not read as
 * permanently inactive. provider_tier_id rows (ft.region_key is null, third-party
 * self-serve) are never license-gated at all; they're outside licenses.feed_types' domain.
 * An explicit admin lapse (status='lapsed', deactivateFeedTierSubscription) always wins
 * regardless of license state -- it's a one-way ratchet, the exception path. */
const REGION_TO_FEED_TYPE_SQL = `case ft.region_key when 'london' then 'london' when 'ny' then 'ny' when 'tokyo' then 'crypto' else null end`;

const EFFECTIVE_STATUS_SQL = `
  case
    when s.status = 'lapsed' then 'lapsed'
    when ft.region_key is null then s.status
    when ${REGION_TO_FEED_TYPE_SQL} is null then s.status
    when exists (
      select 1 from licenses l
      where l.user_id = s.subscriber_user_id
        and l.status = 'active' and l.expires_at > now()
        and ${REGION_TO_FEED_TYPE_SQL} = any(l.feed_types)
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
 * (42P01) rather than a 500 on a live client-facing panel. */
export async function listSubscribersForProvider(providerUserId: string): Promise<ProviderSubscriberRow[]> {
  try {
    const result = await pool.query<{
      id: string;
      seq: number;
      tier_name: string;
      status: SubscriptionStatus;
      started_at: Date;
    }>(
      `select s.id, p.seq, coalesce(ft.name, pt.tier_name) as tier_name, ${EFFECTIVE_STATUS_SQL} as status, s.started_at
       from feed_subscriptions s
       join provider_client_pseudonyms p
         on p.provider_user_id = s.provider_user_id and p.subscriber_user_id = s.subscriber_user_id
       left join feed_tiers ft on ft.id = s.feed_tier_id
       left join provider_tiers pt on pt.id = s.provider_tier_id
       where s.provider_user_id = $1
       order by p.seq`,
      [providerUserId]
    );
    return result.rows.map((row) => ({
      subscriptionId: row.id,
      pseudonym: pseudonymLabel(row.seq),
      tierName: row.tier_name,
      status: row.status,
      startedAt: row.started_at,
    }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Overview panel's "Subscribers" stat -- distinct subscribers currently trial/active,
 * where a Horizon-catalogue row counts only if its region is still license-entitled (see
 * EFFECTIVE_STATUS_SQL above) as well as not explicitly lapsed. Degrades to 0
 * pre-migration, same rule as every other counter this panel renders. */
export async function getActiveSubscriberCountForProvider(providerUserId: string): Promise<number> {
  try {
    const result = await pool.query<{ count: string }>(
      `select count(distinct s.subscriber_user_id) as count
       from feed_subscriptions s
       left join feed_tiers ft on ft.id = s.feed_tier_id
       where s.provider_user_id = $1 and (${EFFECTIVE_STATUS_SQL}) != 'lapsed'`,
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
 * region -- deliberately excludes provider_tier_id rows, which belong to real third-party
 * providers and are never something this admin control should read, show, or touch. A client
 * can hold access in more than one region at once (London Base and NY are separately
 * purchasable packages), so the grain here is (subscriber, region), not (subscriber). At most
 * one row per region is expected (assignFeedTierSubscription enforces that going forward); if
 * more than one somehow exists for a region, the most recently started row wins. */
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
    `select distinct on (ft.region_key) s.id, ft.tier_key, ft.name, ft.region_key, s.status, s.lapsed_at
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

export class FeedTierNotAssignedError extends Error {
  constructor(tierName: string, regionKey: string) {
    const regionLabel = REGION_LABELS[regionKey] ?? regionKey;
    super(`${tierName} (${regionLabel}) isn't assigned to a provider account yet -- it needs a provider assigned before it can be granted`);
    this.name = "FeedTierNotAssignedError";
  }
}

/** Admin-facing upsert: grants (or moves) a subscriber's ONE Horizon-catalogue subscription
 * per REGION. Idempotent -- re-saving the same tierKey is a no-op, and switching tiers within
 * a region reuses that region's existing row (update) rather than inserting a second one, so a
 * client can never end up with two feed_tier_id rows for the same region from this control.
 * Assigning a tier in a different region than any existing subscription is a separate grant,
 * not a move -- a client can hold London and NY access at once (bus thread
 * feed-subscription-recording-build-2026-09-03, marcus ruling: key on (subscriber, region),
 * not (subscriber), since the two are independently purchasable packages). Status is 'active'
 * (not createSubscription's 'trial' default): this is a direct admin grant, not the
 * request/trial flow. */
export async function assignFeedTierSubscription(subscriberUserId: string, tierKey: string): Promise<void> {
  const tier = await pool.query<{ id: string; name: string; region_key: string; provider_user_id: string | null }>(
    `select id, name, region_key, provider_user_id from feed_tiers where tier_key = $1`,
    [tierKey]
  );
  if (!tier.rowCount) throw new Error(`Unknown feed tier: ${tierKey}`);
  const { id: feedTierId, name: tierName, region_key: regionKey, provider_user_id: providerUserId } = tier.rows[0];
  if (!providerUserId) throw new FeedTierNotAssignedError(tierName, regionKey);

  const existing = await pool.query<{ id: string; feed_tier_id: string; provider_user_id: string }>(
    `select s.id, s.feed_tier_id, s.provider_user_id
     from feed_subscriptions s
     join feed_tiers ft on ft.id = s.feed_tier_id
     where s.subscriber_user_id = $1 and ft.region_key = $2
     order by s.started_at desc limit 1`,
    [subscriberUserId, regionKey]
  );

  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.feed_tier_id === feedTierId && row.provider_user_id === providerUserId) {
      await pool.query(
        `update feed_subscriptions set status = 'active', lapsed_at = null, updated_at = now() where id = $1`,
        [row.id]
      );
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      await assignPseudonymSeq(client, providerUserId, subscriberUserId);
      await client.query(
        `update feed_subscriptions
         set feed_tier_id = $2, provider_user_id = $3, status = 'active', lapsed_at = null, updated_at = now()
         where id = $1`,
        [row.id, feedTierId, providerUserId]
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

  await createSubscription({ providerUserId, subscriberUserId, feedTierId, status: "active" });
}

/** Ends the subscriber's Horizon-catalogue subscription for ONE region -- sets status='lapsed'
 * so it drops out of getActiveSubscriberCountForProvider and the provider's Accounts list
 * shows it as lapsed (existing behaviour, not new). Scoped to regionKey so ending NY access
 * never touches a client's separate London row. No-op if there's no such row or it's already
 * lapsed. */
export async function deactivateFeedTierSubscription(subscriberUserId: string, regionKey: string): Promise<void> {
  await pool.query(
    `update feed_subscriptions s
     set status = 'lapsed', lapsed_at = now(), updated_at = now()
     from feed_tiers ft
     where s.feed_tier_id = ft.id
       and s.subscriber_user_id = $1
       and ft.region_key = $2
       and s.status != 'lapsed'`,
    [subscriberUserId, regionKey]
  );
}
