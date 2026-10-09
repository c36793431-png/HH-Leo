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
import { addApprovedNotice, reportUnreachable } from "./client-reach";
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
 * which feeds it carries, and that we enable the feeds once a server is registered (m60963: the
 * basket flow forwards feed lines only after that; "can only be connected" was not verified). */
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
    `3. Register your server: ${PORTAL}/account/servers - we enable your feeds once your server is registered.`,
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

/** "London trial, 30 days" / "paid licence, 90 days": what a grant was, for the client's dashboard banner and
 * the admin's unreachable alert. Never the key. */
export function grantWhat(opts: { tier: LicenseTier; feedTypes: FeedType[]; issuedAt: Date; expiresAt: Date }): string {
  const feeds = opts.feedTypes.map((f) => FEED_TYPE_META[f]?.name.replace(/ Feed$/, "") ?? f).join(" + ");
  const days = Math.max(1, Math.round((opts.expiresAt.getTime() - opts.issuedAt.getTime()) / DAY_MS));
  const kind = opts.tier === "trial" ? "trial" : `${opts.tier} licence`;
  return `${feeds ? `${feeds} ` : ""}${kind}, ${days} days`;
}

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
  /** Stamped into the admin_actions details. The panel passes nothing, so its rows are unchanged;
   * /admin's per-client buttons pass "admin-dashboard" (marcus m60963). */
  via?: "cli" | "agent-api" | "admin-dashboard";
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
    const what = grantWhat({ tier: tier ?? "paid", feedTypes, issuedAt, expiresAt: new Date(license.expiresAt) });
    await sendKeyAndRecord(actorUserId, license.id, target, subject, message, what);
    await addApprovedNotice(userId, what);
    if (isPaidTier(tier ?? "paid")) {
      await sendPaidGroupInvite(target);
    }
  } else {
    await recordKeyDelivery(actorUserId, userId, license.id, NO_USERS_ROW);
  }

  return { license, delivery: keyDeliveryChannel(target) };
}

export const NO_USERS_ROW: NotifyOutcome = { channel: "none", ok: false, error: "no users row for the licence's user" };

/** Writes the license_key_delivery row. Best-effort: a failed record must not turn a delivered
 * key into an error, or skip the invite after it. */
export async function recordKeyDelivery(actorUserId: string, userId: string, licenseId: string, outcome: NotifyOutcome): Promise<void> {
  // The m60934 shape { licenseId, channel, ok, id | error }, plus attempts only when a fallback happened.
  const { attempts, ...rest } = outcome;
  delete (rest as { unreachable?: true }).unreachable;
  const details = { licenseId, ...rest, ...(attempts && attempts.length > 1 ? { attempts } : {}) };
  await logAdminAction(actorUserId, LICENSE_KEY_DELIVERY_ACTION, userId, details, licenseId).catch((err) =>
    console.error("license_key_delivery record failed", licenseId, err instanceof Error ? err.message : err)
  );
}

/** The key DM or email, then its license_key_delivery row. A throw (network, missing token) is
 * recorded as "threw <Name>" (the name only, as the agent API does), then propagates as before. */
export async function sendKeyAndRecord(
  actorUserId: string,
  licenseId: string,
  target: { userId: string; telegramUserId: string | null; email: string | null },
  subject: string,
  message: string,
  /** What was granted, in words; when given, a delivery that reached nobody raises the unreachable alert. */
  what?: string
): Promise<void> {
  let outcome: NotifyOutcome;
  try {
    outcome = await notifyUser({ userId: target.userId, telegramUserId: target.telegramUserId, email: target.email }, subject, message, {
      propagateTelegramThrow: true,
    });
  } catch (err) {
    const channel = keyDeliveryChannel(target);
    const error = `threw ${err instanceof Error ? err.name : typeof err}`;
    await recordKeyDelivery(actorUserId, target.userId, licenseId, { channel, ok: false, error } as NotifyOutcome);
    throw err;
  }
  await recordKeyDelivery(actorUserId, target.userId, licenseId, outcome);
  if (!outcome.ok && what) await reportUnreachable(target.userId, what, outcome.attempts);
}
