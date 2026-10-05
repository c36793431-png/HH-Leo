import {
  issueLicense,
  getGroupTarget,
  getActiveLicensesForUser,
  isPaidTier,
  type FeedType,
  type IssuedLicense,
  type LicenseTier,
} from "./licenses";
import { logAdminAction } from "./admin";
import { notifyUser } from "./notify";
import { getPortalConfig } from "./portal-config";
import { sendPaidGroupInvite } from "./group-membership";

export const LICENSE_READY_SUBJECT = "Your Horizon HFT license is ready";

export function licenseReadyMessage(opts: {
  licenseKey: string;
  licenseNumber: number;
  showBadge: boolean;
  communityGroupUrl: string;
}): string {
  return `Your${opts.showBadge ? ` HH${opts.licenseNumber}` : ""} license key: ${opts.licenseKey}\n\nLog in at horizonhft.com to download the installer and view full docs.\nCommunity: ${opts.communityGroupUrl}`;
}

export type KeyDelivery = "telegram" | "email" | "none";

/** Which channel notifyUser will use for this recipient: same precedence, read without sending. */
export function keyDeliveryChannel(target: { telegramUserId: string | null; email: string | null } | null): KeyDelivery {
  if (target?.telegramUserId) return "telegram";
  if (target?.email) return "email";
  return "none";
}

export interface IssueNewLicenseForUserArgs {
  actorUserId: string;
  userId: string;
  expiresAt: Date;
  feedTypes: FeedType[];
  tier?: LicenseTier;
  /** Stamped into the admin_actions details. The panel passes nothing, so its rows are unchanged. */
  via?: "cli";
}

/** "Issue new license" after the auth check, shared by issueNewLicenseAction (/admin/users) and
 * scripts/assign-trial.mts so the two can't drift: insert (refuses on an active licence), the
 * admin_actions row, the key DM or email, and the paid-group invite for paid tiers.
 * The key is delivered AFTER the insert. A throw from there on leaves a licence the client may
 * not have been sent, which is why the CLI preflights its env before calling this. */
export async function issueNewLicenseForUser(
  args: IssueNewLicenseForUserArgs
): Promise<{ license: IssuedLicense; delivery: KeyDelivery }> {
  const { actorUserId, userId, expiresAt, feedTypes, tier } = args;
  const license = await issueLicense({ userId, expiresAt, feedTypes, tier });
  await logAdminAction(
    actorUserId,
    "admin_users_issue_license",
    userId,
    {
      licenseId: license.id,
      expiresAt: expiresAt.toISOString(),
      feedTypes,
      tier: tier ?? "paid",
      ...(args.via ? { via: args.via } : {}),
    },
    license.id
  );

  const target = await getGroupTarget(userId);
  if (target) {
    const config = await getPortalConfig();
    const showBadge = (await getActiveLicensesForUser(userId)).length > 1;
    await notifyUser(
      { telegramUserId: target.telegramUserId, email: target.email },
      LICENSE_READY_SUBJECT,
      licenseReadyMessage({
        licenseKey: license.licenseKey,
        licenseNumber: license.licenseNumber,
        showBadge,
        communityGroupUrl: config.communityGroupUrl,
      })
    );
    if (isPaidTier(tier ?? "paid")) {
      await sendPaidGroupInvite(target);
    }
  }

  return { license, delivery: keyDeliveryChannel(target) };
}
