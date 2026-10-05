import {
  issueLicense,
  getGroupTarget,
  getActiveLicensesForUser,
  isPaidTier,
  FEED_TYPE_META,
  type FeedType,
  type IssuedLicense,
  type LicenseTier,
} from "./licenses";
import { logAdminAction } from "./admin";
import { notifyUser, type NotifyOutcome } from "./notify";
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

const DAY_MS = 24 * 60 * 60 * 1000;
const PORTAL = "https://portal.horizonhft.com";

/** "7-day " from the issue time to the expiry, rounded; "" under half a day (an hours-long trial). */
function trialLength(issuedAt: Date, expiresAt: Date): string {
  const days = Math.round((expiresAt.getTime() - issuedAt.getTime()) / DAY_MS);
  return days >= 1 ? `${days}-day ` : "";
}

/** "Mon 12 Oct 2026, 17:20 UTC". No < > or &: the Telegram DM is sent with parse_mode HTML. */
function formatUtc(d: Date): string {
  const [wd, day, mon, year, time] = d.toUTCString().replace(",", "").split(" ");
  return `${wd} ${day} ${mon} ${year}, ${time.slice(0, 5)} UTC`;
}

export function trialReadySubject(opts: { issuedAt: Date; expiresAt: Date }): string {
  return `Your ${trialLength(opts.issuedAt, opts.expiresAt)}Horizon HFT trial is active`;
}

/** The trial's key DM / email (coxwell via marcus m60927): says it is a trial, when it ends,
 * which feeds it carries, and that a feed needs a registered server before it can connect. */
export function trialReadyMessage(opts: {
  licenseKey: string;
  licenseNumber: number;
  showBadge: boolean;
  communityGroupUrl: string;
  issuedAt: Date;
  expiresAt: Date;
  feedTypes: FeedType[];
}): string {
  const feeds = opts.feedTypes.map((f) => FEED_TYPE_META[f]?.name.replace(/ Feed$/, "") ?? f);
  return [
    `${trialReadySubject(opts)}.`,
    `Ends: ${formatUtc(opts.expiresAt)}`,
    ...(feeds.length ? [`Feeds included: ${feeds.join(", ")}`] : []),
    "",
    `Your${opts.showBadge ? ` HH${opts.licenseNumber}` : ""} trial license key: ${opts.licenseKey}`,
    "",
    "Next steps:",
    `1. Log in at ${PORTAL}/login`,
    `2. Download the installer: ${PORTAL}/downloads`,
    `3. Register your server: ${PORTAL}/account/servers`,
    "   Feeds can only be connected once your server is registered.",
    "",
    `Community: ${opts.communityGroupUrl}`,
  ].join("\n");
}

/** The subject and text for a new licence's key: the trial text for tier 'trial', otherwise the
 * paid text, unchanged. One function so the panel, the CLI's dry run and the agent API agree. */
export function licenseNotification(opts: {
  tier: LicenseTier;
  licenseKey: string;
  licenseNumber: number;
  showBadge: boolean;
  communityGroupUrl: string;
  issuedAt: Date;
  expiresAt: Date;
  feedTypes: FeedType[];
}): { subject: string; message: string } {
  if (opts.tier === "trial") return { subject: trialReadySubject(opts), message: trialReadyMessage(opts) };
  return { subject: LICENSE_READY_SUBJECT, message: licenseReadyMessage(opts) };
}

export type KeyDelivery = "telegram" | "email" | "none";

/** The admin_actions row that proves the key send (marcus m60934): one per issue, after the
 * send, never an update of the issue row. details_json = { licenseId, channel, ok, and
 * telegramMessageId | resendEmailId | error }. A Vercel log line ages out in 1h; this does not. */
export const LICENSE_KEY_DELIVERY_ACTION = "license_key_delivery";

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
  via?: "cli" | "agent-api";
  /** The agent API's idempotency key, stamped next to via (fable C7): the reconcile reads it back. */
  idempotencyKey?: string;
}

/** "Issue new license" after the auth check, shared by issueNewLicenseAction (/admin/users) and
 * scripts/assign-trial.mts so the two can't drift: insert (refuses on an active licence), the
 * admin_actions row, the key DM or email and its license_key_delivery row, and the paid-group
 * invite for paid tiers.
 * The key is delivered AFTER the insert. A throw from there on leaves a licence the client may
 * not have been sent, which is why the CLI preflights its env before calling this. */
export async function issueNewLicenseForUser(
  args: IssueNewLicenseForUserArgs
): Promise<{ license: IssuedLicense; delivery: KeyDelivery }> {
  const { actorUserId, userId, expiresAt, feedTypes, tier } = args;
  const issuedAt = new Date();
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
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
    },
    license.id
  );

  const target = await getGroupTarget(userId);
  // Best-effort: a failed record must not turn a delivered key into an error, or skip the invite.
  const recordDelivery = (outcome: NotifyOutcome) =>
    logAdminAction(actorUserId, LICENSE_KEY_DELIVERY_ACTION, userId, { licenseId: license.id, ...outcome }, license.id).catch(
      (err) => console.error("license_key_delivery record failed", license.id, err instanceof Error ? err.message : err)
    );
  if (target) {
    const config = await getPortalConfig();
    const showBadge = (await getActiveLicensesForUser(userId)).length > 1;
    const { subject, message } = licenseNotification({
      tier: tier ?? "paid",
      licenseKey: license.licenseKey,
      licenseNumber: license.licenseNumber,
      showBadge,
      communityGroupUrl: config.communityGroupUrl,
      issuedAt,
      expiresAt: new Date(license.expiresAt),
      feedTypes,
    });
    let outcome: NotifyOutcome;
    try {
      outcome = await notifyUser({ telegramUserId: target.telegramUserId, email: target.email }, subject, message);
    } catch (err) {
      // A throw (network, missing token) still propagates as before; it is recorded first.
      const channel = keyDeliveryChannel(target);
      await recordDelivery({ channel, ok: false, error: `threw ${err instanceof Error ? err.name : typeof err}` } as NotifyOutcome);
      throw err;
    }
    await recordDelivery(outcome);
    if (isPaidTier(tier ?? "paid")) {
      await sendPaidGroupInvite(target);
    }
  } else {
    await recordDelivery({ channel: "none", ok: false, error: "no users row for the licence's user" });
  }

  return { license, delivery: keyDeliveryChannel(target) };
}
