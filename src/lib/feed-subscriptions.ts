import type { PoolClient } from "@neondatabase/serverless";
import { pool } from "./db";
import {
  computeUserActiveFeeds,
  getActiveLicensesForUser,
  isFeedType,
  type ActiveLicense,
  type FeedType,
} from "./licenses";
import { FEED_REGION_TYPE, FEED_REGIONS, isFeedRegion, regionForFeedType, type FeedRegion } from "./feed-tier-catalogue";
import { PACKAGES, packageLabelForTierKey, providerShareCentsFor, isUnpriced } from "./feed-provider-packages";

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
  /** Required, not optional: feed_subscriptions.license_id is NOT NULL as of migration 0081
   * step 4, with no column default and no trigger to fill it, so an insert that omits it fails
   * with a raw 23502 that no layer translates. It is also half of the live business-key index
   * 0081 step 5 installed -- see upsertFeedSubscriptionForRequest below. Callers must resolve a
   * real licence and fail loudly if there isn't one; there is no "unknown licence" sentinel. */
  licenseId: string;
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
  /** The EFFECTIVE status a surface renders -- EFFECTIVE_STATUS_SQL's verdict, then relabelled
   * trial by statusForLicenseTier. Not the stored column; see rawStatus. */
  status: SubscriptionStatus;
  /** The literal `feed_subscriptions.status` column, carried alongside the effective one purely
   * so the lapse REASON can tell the two ways a row dies apart (m49070/m49081): an explicit admin
   * lapse ("Ended {date}", the one-way ratchet, always has lapsed_at) versus a row the licence
   * gate killed while its own column still reads 'active' ("Licence expired {date}"). Nothing may
   * gate money or status on this -- that is `status`'s job, and mixing the two is exactly the bug
   * class EFFECTIVE_STATUS_SQL exists to prevent. */
  rawStatus: SubscriptionStatus;
  startedAt: Date;
  /** When an explicit lapse was recorded, and the licence's own expiry -- the two dates the
   * reason text prints. Both null on a live row. */
  lapsedAt: Date | null;
  endsAt: Date | null;
  licenseExpiresAt: Date | null;
  /** `licenses.tier` of the bound licence. Two jobs, both label-only: statusForLicenseTier reads
   * it to call a live grant trial rather than paying (m49078 item 2), and the reason text reads it
   * to say "Trial ended {date}" instead of "Licence expired {date}" when what ran out was a trial
   * (m49101). Never an entitlement test -- that is EFFECTIVE_STATUS_SQL's, and only its. */
  licenseTier: string | null;
  serverIp: string | null;
  /** This client's own negotiated price (Job C, bus thread
   * leo-provider-subscribers-page-2026-09-06) -- null means no price has ever been negotiated
   * for this client. Per marcus's m46504 ruling there is no fallback to any package/tier
   * default: a caller must render and total null as unset, never substitute a list price and
   * never read it as $0. A stored 0 is the same unknown, not a free client -- see isUnpriced
   * and providerShareCentsFor/-For in feed-provider-packages.ts. */
  priceCents: number | null;
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
 * a trial-originated subscription (approveFeedTierRequest -> upsertFeedSubscriptionForRequest --
 * a different function from the admin picker's assignFeedTierSubscription, but both write the
 * same 'active' literal) is written with status='active' like any other grant, so it can't be
 * told apart from a purchased one by s.status alone. Its subscriber also frequently
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
 * this naming pass.
 *
 * The trial-LICENCE branch (marcus m49097 item 4, 2026-09-12) is the same rule
 * statusForLicenseTier applies on the page, moved here so the Overview headcount and the money
 * cannot disagree about who is a paying client: after m49078 item 2 the Subscribers page labelled
 * HH1/HH2/HH12/HH19 trial while this tile still counted them as subscribers. It sits after the
 * explicit-lapse branch and before every entitlement branch, so a lapse still wins and no
 * licence-expiry logic is touched -- it only renames a row this CASE was going to call live. */
const SUBSCRIBER_STATUS_SQL = `
  case
    when s.status = 'lapsed' then 'lapsed'
    when exists (
      select 1 from licenses lt
      where lt.id = s.license_id and lt.tier = 'trial'
    ) then 'trial'
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

/** The FeedTypes a client's own live grants cover -- the grant half of computeUnlockedFeedTypes
 * below, never used on its own as a card gate (marcus, leo-approval-invisible-to-client-2026-09-11).
 *
 * "Live" is decided by EFFECTIVE_STATUS_SQL itself rather than by s.status, so this inherits
 * the exact licence gate every provider-facing surface already applies: when the licence the
 * grant is bound to expires, the row reads lapsed here too and the card re-locks. A grant must
 * not be able to unlock a feed forever -- that would make this reader a worse entitlement
 * source than the feed_types array it supplements.
 *
 * Rows whose tier has no FeedType are dropped, not guessed: cme maps to null
 * (REGION_TO_FEED_TYPE_SQL / FEED_REGION_TYPE) and provider_tier_id rows have no region_key at
 * all. Neither corresponds to a FEED_CATALOGUE card, so there is nothing here to unlock.
 *
 * Degrades to [] pre-0071 (42P01) like every other reader in this file -- a missing table must
 * never 500 a client's own dashboard. */
export async function computeGrantedFeedTypes(userId: string): Promise<FeedType[]> {
  try {
    const result = await pool.query<{ feed_type: string }>(
      `select distinct ${REGION_TO_FEED_TYPE_SQL} as feed_type
       from feed_subscriptions s
       join feed_tiers ft on ft.id = s.feed_tier_id
       where s.subscriber_user_id = $1
         and ${REGION_TO_FEED_TYPE_SQL} is not null
         and ${EFFECTIVE_STATUS_SQL} <> 'lapsed'`,
      [userId]
    );
    return result.rows.map((r) => r.feed_type).filter(isFeedType);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Which feed cards this client has -- one source for /feeds and /dashboard, so the two can
 * never disagree about the same account (marcus, leo-approval-invisible-to-client-2026-09-11).
 *
 * Union, never a swap. licenses.feed_types alone missed every client whose access came from an
 * approved tier request; grants alone would strand every pre-flow client on feed_types and
 * permanently lock `futures` (no region in FEED_REGIONS) and `cme` (region with no FeedType),
 * neither of which has any subscription path in the data model. The union is the only gate
 * that is correct for both populations.
 *
 * Each arm degrades to [] on its own so one failing source can't erase the other's access. */
export async function computeUnlockedFeedTypes(userId: string): Promise<FeedType[]> {
  const [fromLicenses, fromGrants] = await Promise.all([
    computeUserActiveFeeds(userId).catch((): FeedType[] => []),
    computeGrantedFeedTypes(userId).catch((): FeedType[] => []),
  ]);
  return [...new Set([...fromLicenses, ...fromGrants])];
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
  const { providerUserId, subscriberUserId, licenseId, feedTierId = null, providerTierId = null, status = "trial" } = input;
  if ((feedTierId == null) === (providerTierId == null)) {
    throw new Error("Exactly one of feedTierId or providerTierId is required");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await assignPseudonymSeq(client, providerUserId, subscriberUserId);
    const result = await client.query<{ id: string }>(
      `insert into feed_subscriptions (provider_user_id, subscriber_user_id, license_id, feed_tier_id, provider_tier_id, status)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [providerUserId, subscriberUserId, licenseId, feedTierId, providerTierId, status]
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

/** Trial vs paid, ON TOP of EFFECTIVE_STATUS_SQL -- marcus m49078 item 2 (2026-09-12): HH1, HH2,
 * HH12 and HH19 all hold licences.tier = 'trial' at price_cents 0, yet every provider surface
 * listed them under "paying subscribers only", contradicting its own scope note. A trial-originated
 * grant is written with status = 'active' like any purchased one (see the feed_tier_trials note on
 * EFFECTIVE_STATUS_SQL), so s.status alone cannot tell them apart; the bound licence's tier can.
 *
 * Deliberately NOT a fourth branch inside EFFECTIVE_STATUS_SQL: m49078 rules that the
 * entitlement/licence-expiry branch is coxwell's (21:55Z) and must not be touched, so this only
 * re-labels a row the CASE already decided is live. A 'lapsed' verdict always survives -- both the
 * explicit admin lapse (the one-way ratchet) and the licence-expiry branch.
 *
 * That last point is STRICTER than m49078's literal wording ("and s.status is not 'lapsed'"), and
 * it is a visible difference on live data, not a hypothetical: HH15 and HH18 sit on trial licences
 * that have already EXPIRED (2026-09-06 / 2026-09-09), so s.status is 'active' while the effective
 * status is 'lapsed'. Read literally they would flip lapsed -> trial and lose their expiry date;
 * that would be the licence-expiry branch being overridden from outside, which is the one thing
 * m49078 forbids. They stay lapsed and read "Licence expired {date}". Flagged to marcus; flipping
 * to the literal reading is changing `effective === "lapsed"` to a raw-status test here. */
export function statusForLicenseTier(effective: SubscriptionStatus, licenseTier: string | null): SubscriptionStatus {
  if (effective === "lapsed") return "lapsed";
  return licenseTier === "trial" ? "trial" : effective;
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
 * the true state for most of the London backfill rows, not a bug to paper over.
 *
 * licenses is joined on s.license_id purely to read l.tier for statusForLicenseTier above (trial
 * vs paid, m49078 item 2). It joins on the licences PRIMARY KEY, so like server_registrations it
 * can never fan a subscription row out into several. The entitlement question still belongs to
 * EFFECTIVE_STATUS_SQL's own `exists` sub-select, which is untouched -- this join adds a label,
 * not a second liveness test, and the two must not be merged.
 *
 * The ORDER BY is TOTAL (seq, then started_at, then id) as of 2026-09-12, not just `p.seq`:
 * within one account every row shares a seq, so under `order by p.seq` alone their relative
 * order was unspecified -- and groupAccountSubscriptions then took a package group's status from
 * `members[0]`, so an account holding one lapsed and three active tiers of the same package
 * could read either way. Evidence it was genuinely unpinned rather than incidentally stable:
 * HH1's LD Base rendered its members Beta-first under the old clause and Delta-first (true
 * earliest grant) under this one. I did not catch the *count* flipping, so treat "it flipped in
 * prod" as unproven -- the query simply never guaranteed otherwise.
 *
 * This makes the row set stable; it never decided whether such a group *should* read lapsed.
 * That semantic question (it hid coxwell's own HH20's three 09-11 active London tiers behind a
 * 09-03 lapsed ld-beta-56 row) was ruled by marcus in m49051 and no longer depends on this
 * ORDER BY at all -- see statusForPackageMembers below. The order still fixes which member
 * speaks for a group's price, server IP and member list, so it stays. */
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
      price_cents: number | null;
      license_tier: string | null;
      raw_status: SubscriptionStatus;
      lapsed_at: Date | null;
      ends_at: Date | null;
      license_expires_at: Date | null;
    }>(
      `select s.id, p.seq, coalesce(ft.name, pt.tier_name) as tier_name, ft.tier_key, ft.region_key,
              ${EFFECTIVE_STATUS_SQL} as status, s.started_at, sr.declared_ip, s.price_cents,
              l.tier as license_tier, s.status as raw_status, s.lapsed_at, s.ends_at,
              l.expires_at as license_expires_at
       from feed_subscriptions s
       join provider_client_pseudonyms p
         on p.provider_user_id = s.provider_user_id and p.subscriber_user_id = s.subscriber_user_id
       left join feed_tiers ft on ft.id = s.feed_tier_id
       left join provider_tiers pt on pt.id = s.provider_tier_id
       left join server_registrations sr on sr.license_id = s.license_id
       left join licenses l on l.id = s.license_id
       where s.provider_user_id = $1
       order by p.seq, s.started_at, s.id`,
      [providerUserId]
    );
    return result.rows.map((row) => ({
      subscriptionId: row.id,
      pseudonym: pseudonymLabel(row.seq),
      tierName: row.tier_name,
      tierKey: row.tier_key,
      regionKey: row.region_key,
      status: statusForLicenseTier(row.status, row.license_tier),
      rawStatus: row.raw_status,
      startedAt: row.started_at,
      lapsedAt: row.lapsed_at,
      endsAt: row.ends_at,
      licenseExpiresAt: row.license_expires_at,
      licenseTier: row.license_tier,
      serverIp: row.declared_ip,
      priceCents: row.price_cents,
    }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export type AccountRowGroup =
  | { kind: "package"; pseudonym: string; label: string; status: ProviderSubscriberRow["status"]; members: ProviderSubscriberRow[] }
  | { kind: "single"; row: ProviderSubscriberRow };

/** A package group's status. Ruled by marcus, m49051 (2026-09-12, bus thread
 * leo-provider-revenue-ny-base-2026-09-12), replacing the former `members[0].status`: a group
 * reads ACTIVE if ANY member is effective-active, and LAPSED only when EVERY member is lapsed.
 * His reason: price is written and resolved per package (setFeedSubscriptionPriceForPackage /
 * resolvedPriceCentsFor), so a package holding a live paid tier is live money, and letting one
 * dead tier speak for the whole group under-reports on three surfaces at once. It hid coxwell's
 * own HH20 LD Base -- three tiers live since 09-11 -- behind one lapsed 09-03 ld-beta-56 row.
 * Decided here, inside the grouping, so Revenue, Subscribers and Overview move together once
 * rather than each applying its own predicate.
 *
 * The third outcome is explicit, not a fallthrough: members that are neither any-active nor
 * all-lapsed (a trial-covered tier beside a lapsed one) read "trial", never "active" -- a trial
 * earns no payout (providerShareCentsFor returns null for it) and this rule must not promote one
 * into a paying client. No such group exists in the live data today (35 active / 2 lapsed rows,
 * zero status='trial'), so this branch is written from the type, not from an observed row. */
function statusForPackageMembers(members: ProviderSubscriberRow[]): ProviderSubscriberRow["status"] {
  if (members.some((m) => m.status === "active")) return "active";
  if (members.every((m) => m.status === "lapsed")) return "lapsed";
  return "trial";
}

/** Mirrors groupTiers' package/single split (feed-provider-packages.ts) but scoped per
 * account instead of per provider -- Revenue groups every tier a provider sells, this groups
 * one client's own granted tiers, so a client holding all of LD Base's three tiers reads as
 * one group instead of three unrelated rows. A tier with no PACKAGES entry keeps its own row.
 * Shared by the Subscribers page (rendering) and getProviderMonthlyShareCents below (the
 * Overview/Revenue total) so both walk the exact same groups -- moved here from the
 * Subscribers page 2026-09-06 (Job C follow-up, m46504) for that reason. */
export function groupAccountSubscriptions(rows: ProviderSubscriberRow[]): AccountRowGroup[] {
  const byAccount = new Map<string, ProviderSubscriberRow[]>();
  for (const row of rows) {
    const list = byAccount.get(row.pseudonym) ?? [];
    list.push(row);
    byAccount.set(row.pseudonym, list);
  }

  const groups: AccountRowGroup[] = [];
  for (const [pseudonym, accountRows] of byAccount) {
    const used = new Set<string>();
    for (const pkg of PACKAGES) {
      const members = accountRows.filter((r) => r.tierKey && pkg.tierKeys.includes(r.tierKey));
      if (members.length === 0) continue;
      members.forEach((m) => used.add(m.subscriptionId));
      groups.push({ kind: "package", pseudonym, label: pkg.label, status: statusForPackageMembers(members), members });
    }
    for (const row of accountRows) {
      if (!used.has(row.subscriptionId)) groups.push({ kind: "single", row });
    }
  }
  return groups;
}

/** The one read of a group's status, extracted 2026-09-12 (bus thread
 * leo-provider-revenue-ny-base-2026-09-12) when the Revenue page grew a second view and a
 * region filter and would otherwise have inlined this ternary a fourth and fifth time.
 * Behaviour is unchanged from the copies it replaces in sumProviderShareCents /
 * sumMonthlyGrossCents. The mixed-group question this used to flag as unresolved is now ruled
 * (marcus m49051) and answered by statusForPackageMembers above, which this just reads: a
 * package is active if any member is, lapsed only if all are. Nothing here re-derives a status
 * from member rows, so a caller cannot apply a different predicate to the same group. */
export function statusForGroup(group: AccountRowGroup): ProviderSubscriberRow["status"] {
  return group.kind === "package" ? group.status : group.row.status;
}

/** The region a group belongs to, for the Revenue page's region switch (coxwell 2026-09-12
 * 21:18Z via marcus m49032: "ability to change between region"). Reads feed_tiers.region_key as
 * carried on the row -- the same column the Subscribers page's "By location" note and
 * EFFECTIVE_STATUS_SQL's licence gate key on -- never re-derived from a tier name or a PACKAGES
 * label. Null means no region is recorded for this grant (a provider_tiers row: ft.region_key
 * is null for third-party self-serve tiers), which is a real absence, not a default to London;
 * such a group is visible under "All" and under no single-region filter. A PACKAGES entry is
 * region-local by construction, so the first member carrying a region speaks for the group. */
export function regionKeyForGroup(group: AccountRowGroup): string | null {
  if (group.kind === "package") {
    return group.members.map((m) => m.regionKey).find((r) => r != null) ?? null;
  }
  return group.row.regionKey ?? null;
}

/** A group's start date: the earliest `started_at` among its rows, since a package group has no
 * started_at of its own (bus thread leo-provider-panel-package-labels-2026-09-04, marcus
 * follow-up B). Hoisted out of the Subscribers page 2026-09-12 so the Revenue page's Clients
 * view shows the identical date for the identical group instead of a second reduce.
 * This is a GRANT date, not purchase history -- see m47007; label it as such wherever it lands. */
export function startedAtForGroup(group: AccountRowGroup): Date {
  if (group.kind === "single") return group.row.startedAt;
  return group.members.reduce((earliest, m) => (m.startedAt < earliest ? m.startedAt : earliest), group.members[0].startedAt);
}

/** Job C (bus thread leo-provider-subscribers-page-2026-09-06, coxwell-authorised): the price
 * a payout reads is THIS client's own negotiated feed_subscriptions.price_cents, never a
 * catalogue/package-wide constant -- a partner on a different number must produce a different
 * line. Per marcus's m46504 ruling, there is NO fallback to any package/tier default list
 * price -- a group with no override anywhere resolves to null (unset), which providerShareFor
 * renders as "unpriced" and providerShareCentsFor counts as zero, never as the catalogue's
 * $30. For a package, every member row is written the same price together
 * (setFeedSubscriptionPriceForPackage) so any one member's non-null value speaks for the whole
 * group; this does not sum or average across members, and does not read feed_tiers/ProviderTierRow
 * catalogue prices directly -- that was the members[0]-off-the-catalogue bug this job fixed.
 *
 * A stored 0 resolves as 0 here, unchanged by C3 (m49063). The surfaces spell a 0 "unpriced"
 * (isUnpriced) but this stays the literal stored value: skipping 0 members in the find() below
 * would let a sibling's price speak for a row that does not carry it, which moves money.
 *
 * EFFECTIVE-ACTIVE MEMBERS ONLY, ruled by marcus 2026-09-12 (m49078 item 1, restated m49088 as
 * option (a)). The "every member is written the same price together" invariant above holds only
 * while a group's members are all live: the moment ENDED history and live rows share one
 * (client, package) group, the first non-null price can come from a dead row. That is exactly
 * what happened tonight -- coxwell's own three $30 LD Base rows from his expired paid licence
 * were backfilled beside his live, never-priced team-licence rows, and HH20 rendered $30 / $15,
 * pushing London's total to $90 / $45 off money that is not being paid. A lapsed row is history,
 * not a rate card: a group whose only priced members are lapsed resolves to null and every
 * surface spells it "unpriced". Applied to `single` groups too, so one rule covers both shapes.
 *
 * This is why the Lapsed filter must NOT read its price column from here -- a lapsed group's
 * last known price is a separate question from what it is being charged now, and it needs its
 * own accessor rather than a relaxed version of this one. */
export function resolvedPriceCentsFor(group: AccountRowGroup): number | null {
  if (group.kind === "package") {
    return (
      group.members
        .filter((m) => m.status === "active")
        .map((m) => m.priceCents)
        .find((c) => c != null) ?? null
    );
  }
  return group.row.status === "active" ? group.row.priceCents ?? null : null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** WHY a group isn't paying, for the Paying | Lapsed | All filter (coxwell via marcus m49070,
 * pulled onto the Revenue thread by m49081; the Subscribers page reuses THIS function rather than
 * spelling the same three sentences a second time). Null for a paying group -- a live client needs
 * no explanation, and a null here is what a caller keys "is this row greyed" off.
 *
 * Four outcomes (m49101 fixes the wording): "Ended {date}" is a decision somebody recorded (an
 * explicit admin lapse, always with a lapsed_at), while "Licence expired {date}" is a row nobody
 * touched whose licence simply ran out underneath it -- the provider can act on the second (chase
 * a renewal) and cannot on the first, so collapsing them into one "lapsed" would hide that. When
 * the thing that ran out was a TRIAL licence it reads "Trial ended {date}", because "Licence
 * expired" invites a renewal conversation about a client who was never paying. Plain "Trial"
 * carries no date: that trial has NOT ended, the client is live and simply isn't paying, and a
 * date beside them would read as a lapse.
 *
 * A package group's reason comes from the member that stopped LAST (max date, nulls first, then
 * the pinned member order for ties). A group dies when its final member does, so the latest date
 * is the one a provider would recognise; taking members[0] would let whichever tier happens to
 * sort first speak for the group, which is the members[0] class of bug this file has already been
 * burned by twice. Only members sharing the group's own status are eligible, so a stray live row
 * can't explain a lapsed group. */
export function statusReasonForGroup(group: AccountRowGroup): string | null {
  const status = statusForGroup(group);
  if (status === "active") return null;
  if (status === "trial") return "Trial";

  const rows = group.kind === "package" ? group.members.filter((m) => m.status === status) : [group.row];
  let best: { text: string; at: Date | null } | null = null;
  for (const row of rows) {
    const explicit = row.rawStatus === "lapsed";
    const at = (explicit ? row.lapsedAt ?? row.endsAt : row.licenseExpiresAt ?? row.endsAt) ?? null;
    const label = explicit ? "Ended" : row.licenseTier === "trial" ? "Trial ended" : "Licence expired";
    const candidate = { text: at ? `${label} ${isoDate(at)}` : label, at };
    if (best == null || (candidate.at != null && (best.at == null || candidate.at > best.at))) best = candidate;
  }
  return best?.text ?? null;
}

/** The LAST price a non-paying group carried, for the Lapsed filter's price cell (m49070: "their
 * LAST price shown as text not money"). Deliberately a separate accessor from
 * resolvedPriceCentsFor rather than a flag on it: that function answers "what is this client
 * being charged", which for a group with no live priced member is nothing at all, and relaxing it
 * to answer this question too is precisely the defect ruling (a) fixed. Callers must render this
 * as text and must never add it to a total -- a lapsed client's old price is history, not revenue.
 *
 * Reads the most RECENTLY started member that carries a price (started_at desc, subscriptionId as
 * the tie-break so the walk is totally ordered), which is the last price actually written for this
 * client-package. Null, and "unpriced" on screen, when no member ever had one. */
export function lastPriceCentsFor(group: AccountRowGroup): number | null {
  if (group.kind === "single") return group.row.priceCents ?? null;
  return (
    [...group.members]
      .sort((a, b) =>
        b.startedAt.getTime() - a.startedAt.getTime() || a.subscriptionId.localeCompare(b.subscriptionId)
      )
      .map((m) => m.priceCents)
      .find((c) => c != null) ?? null
  );
}

/** The one place that walks account groups and adds up the provider's 50% share, bus thread
 * leo-provider-subscribers-page-2026-09-06 (marcus, m46511/m46518: "is the summation also one
 * implementation, or does Subscribers' footer run its own reduce ... agreement at zero is not
 * agreement"). Subscribers' footer/header, the Overview Revenue card (via
 * getProviderMonthlyShareCents below), and the Revenue page's Total row all call THIS on
 * groups they derive from groupAccountSubscriptions -- never their own reduce over the same
 * shape -- so a lapsed row, a null price, or a second region can't make one surface disagree
 * with another. */
export function sumProviderShareCents(groups: AccountRowGroup[]): number {
  return groups.reduce((sum, g) => {
    const cents = providerShareCentsFor(statusForGroup(g), resolvedPriceCentsFor(g));
    return sum + (cents ?? 0);
  }, 0);
}

/** Same-shape sibling of sumProviderShareCents for the gross (pre-split) monthly figure --
 * bus thread leo-provider-subscribers-page-2026-09-06 (marcus's closing ruling, m46522):
 * extracted now, before any surface renders a gross total, since coxwell's "total made, which
 * amount made on which base" ask is all gross figures and a second reduce added after three
 * surfaces already show gross would need reconciling instead of just existing. Only
 * status === "active" groups count, same predicate as sumProviderShareCents; a null resolved
 * price contributes zero, distinguishable from a real $0. */
export function sumMonthlyGrossCents(groups: AccountRowGroup[]): number {
  return groups.reduce((sum, g) => {
    if (statusForGroup(g) !== "active") return sum;
    return sum + (resolvedPriceCentsFor(g) ?? 0);
  }, 0);
}

/** How many of the paying groups behind a money total actually carry a price (marcus C3,
 * m49063): "a package line whose priced members are fewer than its subscribers shows the
 * priced count beside the money, e.g. '6 subscribers, 1 priced, $30', so nobody divides $30 by
 * 6". Walks the SAME groups and the same active predicate as sumProviderShareCents /
 * sumMonthlyGrossCents above, so the count beside a figure can never describe a different row
 * set than the figure does. `priced` is also what tells a $0 total from an unknown one:
 * priced === 0 means no row behind the total has a price at all, and moneyOrUnpriced then
 * prints "unpriced" rather than "$0". */
export function pricedGroupCounts(groups: AccountRowGroup[]): { priced: number; subscribers: number } {
  let priced = 0;
  let subscribers = 0;
  for (const g of groups) {
    if (statusForGroup(g) !== "active") continue;
    subscribers += 1;
    if (!isUnpriced(resolvedPriceCentsFor(g))) priced += 1;
  }
  return { priced, subscribers };
}

/** Fetch-and-sum wrapper around sumProviderShareCents for callers (Overview) that don't
 * already have the provider's groups in memory. Callers that do (Subscribers, Revenue) should
 * call sumProviderShareCents directly on their existing groups instead of re-querying. */
export async function getProviderMonthlyShareCents(providerUserId: string): Promise<number> {
  const subscribers = await listSubscribersForProvider(providerUserId);
  const groups = groupAccountSubscriptions(subscribers);
  return sumProviderShareCents(groups);
}

/** Overview panel's "Subscribers" stat -- distinct subscribers with a live, non-trial grant,
 * where a Horizon-catalogue row counts only if its region is still license-entitled (see
 * SUBSCRIBER_STATUS_SQL above) as well as not explicitly lapsed and not merely trial-covered.
 * Degrades to 0 pre-migration, same rule as every other counter this panel renders.
 *
 * Tests `= 'active'` rather than `!= 'lapsed'` since m49097 item 4: SUBSCRIBER_STATUS_SQL can now
 * answer 'trial' (a grant on a trial LICENCE), and a headcount that counted anything not-lapsed
 * would keep calling those clients subscribers while the money on Subscribers/Revenue calls them
 * trial. There is no third live value for this to exclude by accident -- 'active' and 'trial' are
 * the only non-lapsed outcomes. */
export async function getActiveSubscriberCountForProvider(providerUserId: string): Promise<number> {
  try {
    const result = await pool.query<{ count: string }>(
      `select count(distinct s.subscriber_user_id) as count
       from feed_subscriptions s
       left join feed_tiers ft on ft.id = s.feed_tier_id
       where s.provider_user_id = $1 and (${SUBSCRIBER_STATUS_SQL}) = 'active'`,
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
  /** null means no per-client price has ever been negotiated -- admin UI should present this
   * as unset ("Not set"/"—"), never as $0 and never as the package's list price (m46504: no
   * default fallback). See setFeedSubscriptionPriceForPackage below. */
  priceCents: number | null;
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
    price_cents: number | null;
  }>(
    `select s.id, ft.tier_key, ft.name, ft.region_key, s.status, s.lapsed_at, s.price_cents
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
    priceCents: row.price_cents,
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

/** Thrown by assignFeedTierSubscription when the target subscriber holds no active, unexpired
 * licence. A feed grant is bound to a licence (feed_subscriptions.license_id, NOT NULL since
 * 0081) because that is the grain a grant has -- one server's access on one licence -- so there
 * is nothing to bind to here and no honest way to invent one. Deliberately a refusal rather
 * than a fallback: picking the subscriber's latest-issued or most-recently-expired licence
 * would pin the grant to a dead or revoked row, which then reads 'lapsed' through
 * EFFECTIVE_STATUS_SQL's licence gate anyway -- a grant the admin was told succeeded and the
 * client never receives. Granting a feed tier to a licence-less user IS the feed-only-client
 * case; that mechanism is not built (it is queued on Fable's feed-only plan, where the
 * subscription-level clock and the replacement business key get decided together), so the
 * correct answer today is an error that says why. Message is surfaced verbatim to the admin by
 * runAction (lib/action-result.ts). */
export class NoActiveLicenseForFeedGrantError extends Error {
  constructor(tierName: string) {
    super(`This user has no active, unexpired licence, so ${tierName} can't be granted -- a feed subscription is bound to a licence. Issue or renew a licence first.`);
    this.name = "NoActiveLicenseForFeedGrantError";
  }
}

/** Thrown by assignFeedTierSubscription when the target subscriber holds MORE than one active,
 * unexpired licence. A grant binds to exactly one licence and a licence names one server, so
 * taking the furthest-expiring row would tie the grant to a server the admin never chose -- and
 * no surface anywhere renders which licence a subscription is bound to, so that choice would be
 * invisible until it was wrong. Hence a refusal rather than a tiebreak (marcus's ruling, thread
 * leo-feed-subscriptions-license-id-2026-09-10): a grant path must never silently pick between
 * two live licences. *Choosing* between them is a business decision and stays queued with the
 * feed-only plan; *refusing* to choose is the honest default and needs no such decision.
 * Deliberately NOT enforced inside getActiveLicenseForUser (same ruling) -- that resolver is
 * shared with callers who legitimately want *a* licence, and making it raise would break them.
 * The route that already works for a multi-licence subscriber is the client's own feed-tier
 * request: it carries feed_tier_requests.license_id, the licence they registered the server
 * against, so approving it binds the grain the client picked instead of one this path guessed.
 * Licences are named by the HH<n> label (licenseNumberSql) the admin already sees on the user's
 * row and detail page, so the message points at something on screen -- never the licence key.
 * Message is surfaced verbatim to the admin by runAction (lib/action-result.ts). */
export class MultipleActiveLicensesForFeedGrantError extends Error {
  constructor(tierName: string, licenses: ActiveLicense[]) {
    const named = licenses
      .map((l) => `HH${l.licenseNumber} (expires ${l.expiresAt.toLocaleDateString()})`)
      .join(", ");
    super(
      `This user holds ${licenses.length} active licences -- ${named} -- so ${tierName} can't be granted from here: a feed subscription binds to one licence, and picking one here would tie the grant to a server nobody chose. Approve the client's own request for this tier instead -- it carries the licence they registered the server against.`
    );
    this.name = "MultipleActiveLicensesForFeedGrantError";
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
 * scoped to live rows, but it is keyed on (license_id, feed_tier_id) -- migration 0081 step 5
 * DROPped the (subscriber_user_id, feed_tier_id) index this comment used to name
 * (feed_subscriptions_subscriber_feed_tier_live_uidx) and replaced it in the same transaction
 * with feed_subscriptions_license_feed_tier_live_uidx on (license_id, feed_tier_id) WHERE
 * feed_tier_id IS NOT NULL AND status IN ('trial','active'). Per-licence grain, which is the
 * grain a grant actually has: the same subscriber legitimately holds the same tier twice under
 * two different licences (two servers), and that is no longer a collision. If a DIFFERENT
 * request_id collides with an already-live grant for the same (licence, tier) -- including a
 * different member of the same package colliding with an unrelated direct grant on that same
 * licence -- the insert throws a Postgres unique_violation on THAT index, which this rethrows as
 * DuplicateTierGrantError -- the caller's transaction rolls back and the whole approval fails
 * loudly, no partial package grant. licenseId is the request's OWN feed_tier_requests.license_id,
 * passed down by the caller rather than re-derived from the subscriber: it is the licence the
 * client registered a server against when they asked for this tier, so it is the correct grain
 * and not merely a convenient one, and it is already on the row (no lookup, nothing to race).
 * Must run inside the SAME transaction as the request's status flip to 'approved'
 * (caller's job) -- feed_tier_requests carries no subscription_id column
 * (dropped, migration 0080); the relation is feed_subscriptions.request_id, and "is this request
 * granted" is the request's own status column. */
export async function upsertFeedSubscriptionForRequest(
  client: PoolClient,
  args: { requestId: string; providerUserId: string; subscriberUserId: string; licenseId: string; feedTierId: string; tierName: string }
): Promise<string> {
  const { requestId, providerUserId, subscriberUserId, licenseId, feedTierId, tierName } = args;
  await assignPseudonymSeq(client, providerUserId, subscriberUserId);
  try {
    const result = await client.query<{ id: string }>(
      `insert into feed_subscriptions (provider_user_id, subscriber_user_id, license_id, feed_tier_id, status, request_id)
       values ($1, $2, $3, $4, 'active', $5)
       on conflict (request_id, feed_tier_id) where request_id is not null and feed_tier_id is not null do update
         set status = 'active', lapsed_at = null, provider_user_id = excluded.provider_user_id,
             license_id = excluded.license_id, updated_at = now()
       returning id`,
      [providerUserId, subscriberUserId, licenseId, feedTierId, requestId]
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
 * on the business key -- now (licence, tier), per the licence-binding note below -- because
 * there is no request identity here to upsert on instead, and idempotent re-click-to-reactivate
 * is the desired admin UX, not an error condition.
 * Fable's "never upsert on a business key" targets the approval path specifically,
 * where a retried/duplicated REQUEST must not silently coalesce into an unrelated grant.
 *
 * LICENCE BINDING (marcus's ruling, thread leo-feed-subscriptions-license-id-2026-09-10):
 * feed_subscriptions.license_id is NOT NULL since 0081 step 4 with no default and no trigger,
 * and this path supplied nothing for it -- every admin direct grant of a tier the subscriber
 * didn't already hold died on a raw 23502 that no layer translates. The licence is resolved
 * explicitly here via getActiveLicensesForUser (status = 'active' AND expires_at > now()).
 * NOT getLatestIssuedLicenseForUser: that one is latest-issued with no status or expiry filter
 * and would happily pin a grant to a revoked licence. BOTH non-singular cases are refusals, not
 * fallbacks -- zero throws NoActiveLicenseForFeedGrantError, more than one throws
 * MultipleActiveLicensesForFeedGrantError (see both above). The plural resolver is called
 * precisely so this path can SEE a second licence: getActiveLicenseForUser answers the same
 * predicate but `limit 1` on `expires_at desc`, so it would hand back the furthest-expiring row
 * with no indication a choice had been made. It stays as it is -- it is shared with callers that
 * legitimately want *a* licence -- so the guard lives here, in the write path, not in it.
 * With exactly one active licence the two resolvers return the same row, so the singular case
 * is unchanged; the ordering only ever mattered in the case this now refuses.
 *
 * The reactivate lookup below is scoped by license_id as well as feed_tier_id -- the same key
 * the live partial unique index uses since 0081 step 5 (which DROPped the (subscriber, tier)
 * index). Scoping it on (subscriber, tier) instead would find a row bound to a DIFFERENT,
 * now-expired licence and flip it to 'active', and EFFECTIVE_STATUS_SQL's licence gate would
 * still read that row 'lapsed' -- the admin sees success and the client gets nothing. Under the
 * per-licence index such a row is not a conflict at all, so the correct outcome is a NEW row
 * bound to the live licence, which is what this now does. */
export async function assignFeedTierSubscription(subscriberUserId: string, tierKey: string): Promise<void> {
  const { feedTierId, tierName, regionKey, providerUserId } = await getFeedTierForAssignment(tierKey);
  if (!providerUserId) throw new FeedTierNotAssignedError(tierName, regionKey);

  const licenses = await getActiveLicensesForUser(subscriberUserId);
  if (licenses.length === 0) throw new NoActiveLicenseForFeedGrantError(tierName);
  if (licenses.length > 1) throw new MultipleActiveLicensesForFeedGrantError(tierName, licenses);
  const license = licenses[0];

  const existing = await pool.query<{ id: string; provider_user_id: string }>(
    `select id, provider_user_id from feed_subscriptions where license_id = $1 and feed_tier_id = $2`,
    [license.id, feedTierId]
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
    await createSubscription({ providerUserId, subscriberUserId, licenseId: license.id, feedTierId, status: "active" });
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

/** Admin-facing price write, Job C (bus thread leo-provider-subscribers-page-2026-09-06,
 * coxwell-authorised 2026-09-05/06). price_cents lives on the SUBSCRIPTION, not the catalogue,
 * because the provider's 50% cut is of what THIS client actually pays -- a partner on a
 * different number must produce a different payout line, which a catalogue-level price could
 * never do. A package is the unit of sale (same rule Job A1 applied to row layout), so setting
 * a price here fans out to every member tier's subscription row for this subscriber, not just
 * the one tierKey passed in -- a client's package must always read one price, never a
 * per-member split the schema was never designed to hold. A tier outside any PACKAGES entry
 * updates only itself. Only touches rows that already exist for this subscriber (no upsert,
 * no create) -- there is nothing sensible to price before a grant exists. null clears the
 * override, and the read side's COALESCE falls back to the package/tier's default list price,
 * not to $0. */
export async function setFeedSubscriptionPriceForPackage(
  subscriberUserId: string,
  tierKey: string,
  priceCents: number | null
): Promise<void> {
  const label = packageLabelForTierKey(tierKey);
  const siblingTierKeys = label ? PACKAGES.find((p) => p.label === label)!.tierKeys : [tierKey];
  await pool.query(
    `update feed_subscriptions s
     set price_cents = $3, updated_at = now()
     from feed_tiers ft
     where s.feed_tier_id = ft.id
       and s.subscriber_user_id = $1
       and ft.tier_key = any($2)`,
    [subscriberUserId, siblingTierKeys, priceCents]
  );
}
