import { assignFeedTierSubscription, type FeedTierGrantResult } from "./feed-subscriptions";
import { logAdminAction } from "./admin";

export interface AssignFeedTierForUserArgs {
  actorUserId: string;
  userId: string;
  tierKey: string;
  /** Stamped into the admin_actions details. The panel passes nothing, so its rows are unchanged. */
  via?: "cli";
}

/** "Feed provider assignment" after the auth check, shared by assignFeedSubscriptionAction
 * (/admin/users/[id]) and scripts/assign-feed.mts so the two can't drift: the grant (every
 * refusal lives inside assignFeedTierSubscription) and then the admin_actions row. DB only: no
 * DM, no email, and nobody is told. The provider still allowlists the server's IP by hand. */
export async function assignFeedTierForUser(args: AssignFeedTierForUserArgs): Promise<FeedTierGrantResult> {
  const { actorUserId, userId, tierKey } = args;
  const result = await assignFeedTierSubscription(userId, tierKey);
  await logAdminAction(
    actorUserId,
    "admin_users_assign_feed_subscription",
    userId,
    { tierKey, ...(args.via ? { via: args.via } : {}) },
    null
  );
  return result;
}
