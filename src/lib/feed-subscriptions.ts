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
      `select s.id, p.seq, coalesce(ft.name, pt.tier_name) as tier_name, s.status, s.started_at
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

/** Overview panel's "Subscribers" stat -- distinct subscribers currently trial/active
 * (lapsed excluded: this answers "who subscribes to this provider's packages right now").
 * Degrades to 0 pre-migration, same rule as every other counter this panel renders. */
export async function getActiveSubscriberCountForProvider(providerUserId: string): Promise<number> {
  try {
    const result = await pool.query<{ count: string }>(
      `select count(distinct subscriber_user_id) as count
       from feed_subscriptions
       where provider_user_id = $1 and status in ('trial', 'active')`,
      [providerUserId]
    );
    return Number(result.rows[0]?.count ?? 0);
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
}
