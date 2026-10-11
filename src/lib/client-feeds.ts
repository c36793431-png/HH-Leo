import { pool } from "./db";
import { EFFECTIVE_STATUS_SQL } from "./feed-subscriptions";
import { feedTierMeta, isFeedRegion, type FeedRegion } from "./feed-tier-catalogue";

/** One row of /admin/client-feeds (marcus m63917 B2): a feed_subscriptions row with everything an
 * admin needs to see what a client holds, in one place. READ-ONLY: one select, no pseudonym reads
 * (those allocate), no writes. */
export interface ClientFeedRow {
  subscriptionId: string;
  userId: string;
  email: string | null;
  telegramUsername: string | null;
  displayName: string | null;
  tierName: string;
  region: FeedRegion | null;
  /** EFFECTIVE_STATUS_SQL's verdict, not the raw column. */
  status: string;
  /** The envelope's decision; "direct grant" when there is no envelope (the /admin/users grant). */
  grant: "trial" | "paid" | "direct grant" | null;
  startedAt: Date;
  endsAt: Date | null;
  priceCents: number | null;
  serverName: string | null;
  declaredIp: string | null;
  /** IPs of this (server, tier)'s allowlist records that are still open, oldest first. */
  allowlistOpenIps: string[];
  allowlistRevokedCount: number;
  /** ends_at has passed but the row still reads live. CME is ungated, so nothing lapses it at its end
   * (feed-subscriptions.ts EFFECTIVE_STATUS_SQL): the admin has to see these. */
  pastEndStillActive: boolean;
}

export async function listClientFeeds(options: { region?: string } = {}): Promise<ClientFeedRow[]> {
  const region = options.region && isFeedRegion(options.region) ? options.region : null;
  const result = await pool.query(
    `select s.id, s.subscriber_user_id, u.email, u.telegram_username, u.display_name,
            ft.tier_key, coalesce(ft.name, pt.tier_name) as tier_name, ft.region_key,
            ${EFFECTIVE_STATUS_SQL} as status,
            s.access_request_id, ar.decision,
            s.started_at, s.ends_at, s.price_cents, sr.server_name, sr.declared_ip,
            coalesce(al.open_ips, '{}') as open_ips, coalesce(al.revoked_n, 0) as revoked_n
     from feed_subscriptions s
     left join feed_tiers ft on ft.id = s.feed_tier_id
     left join provider_tiers pt on pt.id = s.provider_tier_id
     left join users u on u.id = s.subscriber_user_id
     left join server_registrations sr on sr.id = s.server_registration_id
     left join access_requests ar on ar.id = s.access_request_id
     left join lateral (
       select array_agg(r.ip order by r.told_at) filter (where r.revoked_at is null) as open_ips,
              (count(*) filter (where r.revoked_at is not null))::int as revoked_n
       from feed_allowlist_records r
       where r.server_registration_id = s.server_registration_id and r.feed_tier_id = s.feed_tier_id
     ) al on true
     where $1::text is null or ft.region_key = $1
     order by s.started_at desc, s.id`,
    [region]
  );
  const now = Date.now();
  const rows: ClientFeedRow[] = result.rows.map((r) => {
    const endsAt: Date | null = r.ends_at ? new Date(r.ends_at) : null;
    return {
      subscriptionId: r.id,
      userId: r.subscriber_user_id,
      email: r.email ?? null,
      telegramUsername: r.telegram_username ?? null,
      displayName: r.display_name ?? null,
      tierName: (r.tier_key && feedTierMeta(r.tier_key)?.name) || r.tier_name || "—",
      region: r.region_key && isFeedRegion(r.region_key) ? r.region_key : null,
      status: r.status,
      grant: r.decision === "trial" || r.decision === "paid" ? r.decision : r.access_request_id ? null : "direct grant",
      startedAt: new Date(r.started_at),
      endsAt,
      priceCents: r.price_cents ?? null,
      serverName: r.server_name ?? null,
      declaredIp: r.declared_ip ?? null,
      allowlistOpenIps: r.open_ips ?? [],
      allowlistRevokedCount: Number(r.revoked_n ?? 0),
      pastEndStillActive: endsAt !== null && endsAt.getTime() < now && r.status !== "lapsed",
    };
  });
  // Past-end rows first, so they are seen; the newest first within each group (the select's order).
  return [...rows.filter((r) => r.pastEndStillActive), ...rows.filter((r) => !r.pastEndStillActive)];
}
