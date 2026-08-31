"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import {
  issueLicense,
  issueAdditionalLicense,
  extendLicense,
  revokeLicenseAndSyncGroup,
  getLicenseExpiresAt,
  setLicenseTier,
  setLicenseFeedTypes,
  getGroupTarget,
  isPaidTier,
  LICENSE_TIERS,
  FEED_TYPES,
  type LicenseTier,
  type FeedType,
} from "@/lib/licenses";
import { parseDurationFormData, resolveExpiresAt } from "@/lib/duration";
import { logAdminAction, resolveAdminUserId } from "@/lib/admin";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { sendPaidGroupInvite } from "@/lib/group-membership";
import { notifyUser } from "@/lib/notify";
import { getPortalConfig } from "@/lib/portal-config";
import {
  saveConfigSummary,
  parseConfigParamsText,
  CONFIG_SUMMARY_STRATEGIES,
  type ConfigSummaryStrategy,
} from "@/lib/config-summary";
import { EDITABLE_USER_ROLES, type EditableUserRole } from "@/lib/admin-user-roles";

async function requireAdminUsersPanel(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) {
    throw new Error("forbidden");
  }
  return session.user.id;
}

function revalidateUsers(userId?: string | null) {
  revalidatePath("/admin/users");
  if (userId) revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/licenses");
  revalidatePath("/admin/history");
}

async function getLicenseOwner(licenseId: string): Promise<string | null> {
  const result = await pool.query<{ user_id: string | null }>(
    "select user_id from licenses where id = $1",
    [licenseId]
  );
  return result.rows[0]?.user_id ?? null;
}

export async function expireNowAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to expire license", async () => {
    const adminUserId = await requireAdminUsersPanel();
    const licenseId = formData.get("licenseId") as string;
    const ownerId = await getLicenseOwner(licenseId);
    await pool.query("update licenses set expires_at = now() where id = $1", [licenseId]);
    await logAdminAction(adminUserId, "admin_users_expire_now", ownerId, { licenseId }, licenseId);
    revalidateUsers(ownerId);
  });
}

export async function extendLicenseAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to extend license", async () => {
    const adminUserId = await requireAdminUsersPanel();
    const licenseId = formData.get("licenseId") as string;
    const ownerId = await getLicenseOwner(licenseId);
    const current = await getLicenseExpiresAt(licenseId);
    const expiresAt = resolveExpiresAt(parseDurationFormData(formData), current);
    await extendLicense(licenseId, expiresAt);
    await logAdminAction(adminUserId, "admin_users_extend", ownerId, { licenseId, expiresAt: expiresAt.toISOString() }, licenseId);
    revalidateUsers(ownerId);
  });
}

export async function revokeAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to revoke license", async () => {
    const adminUserId = await requireAdminUsersPanel();
    const licenseId = formData.get("licenseId") as string;
    const ownerId = await getLicenseOwner(licenseId);
    await revokeLicenseAndSyncGroup(licenseId);
    await logAdminAction(adminUserId, "admin_users_revoke", ownerId, { licenseId }, licenseId);
    revalidateUsers(ownerId);
  });
}

export async function setUserLicenseTierAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to update tier", async () => {
    const adminUserId = await requireAdminUsersPanel();
    const licenseId = formData.get("licenseId") as string;
    const tier = formData.get("tier") as string;
    if (!LICENSE_TIERS.includes(tier as LicenseTier)) throw new Error("Invalid tier");
    const ownerId = await getLicenseOwner(licenseId);
    await setLicenseTier(licenseId, tier as LicenseTier);
    await logAdminAction(adminUserId, "admin_users_set_tier", ownerId, { licenseId, tier }, licenseId);
    revalidateUsers(ownerId);
  });
}

function readFeedTypesFromFormData(formData: FormData): FeedType[] {
  return formData
    .getAll("feedTypes")
    .filter((f): f is string => typeof f === "string" && (FEED_TYPES as string[]).includes(f)) as FeedType[];
}

export async function updateLicenseFeedsAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to update feeds", async () => {
    const adminUserId = await requireAdminUsersPanel();
    const licenseId = formData.get("licenseId") as string;
    const feedTypes = readFeedTypesFromFormData(formData);
    const ownerId = await getLicenseOwner(licenseId);
    await setLicenseFeedTypes(licenseId, feedTypes);
    await logAdminAction(adminUserId, "admin_users_set_feeds", ownerId, { licenseId, feedTypes }, licenseId);
    revalidateUsers(ownerId);
  });
}

const ADMIN_EDITABLE_USER_FIELDS = ["display_name", "email", "role", "telegram_username", "active_ip"] as const;
type AdminEditableUserField = (typeof ADMIN_EDITABLE_USER_FIELDS)[number];

export async function updateUserFieldAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to update user", async () => {
    const adminUserId = await requireAdminUsersPanel();
    const userId = formData.get("userId") as string;
    const field = formData.get("field") as string;
    if (!ADMIN_EDITABLE_USER_FIELDS.includes(field as AdminEditableUserField)) {
      throw new Error("Invalid field");
    }
    const value = ((formData.get("value") as string) ?? "").trim();
    if (field === "role" && !EDITABLE_USER_ROLES.includes(value as EditableUserRole)) {
      throw new Error("Invalid role");
    }
    if (field === "email" && value === "") {
      throw new Error("Email is required");
    }
    const nextValue =
      field === "telegram_username"
        ? value.replace(/^@/, "") || null
        : (field === "display_name" || field === "active_ip") && value === ""
          ? null
          : value;

    const current = await pool.query<{ value: string | null }>(
      `select ${field} as value from users where id = $1`,
      [userId]
    );
    if (current.rowCount === 0) throw new Error("User not found");
    const previousValue = current.rows[0].value;

    await pool.query(`update users set ${field} = $1 where id = $2`, [nextValue, userId]);
    await logAdminAction(
      adminUserId,
      "admin_users_update_field",
      userId,
      { field, from: previousValue, to: nextValue },
      null
    );
    revalidateUsers(userId);
  });
}

export async function updateUserNotesAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to save notes", async () => {
    const adminUserId = await requireAdminUsersPanel();
    const userId = formData.get("userId") as string;
    const notes = ((formData.get("notes") as string) ?? "").trim();
    const nextValue = notes === "" ? null : notes;

    await pool.query("update users set admin_notes = $1 where id = $2", [nextValue, userId]);
    await logAdminAction(adminUserId, "admin_users_update_notes", userId, { notes: nextValue }, null);
    revalidateUsers(userId);
  });
}

export async function updateConfigSummaryAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to save config summary", async () => {
    const adminUserId = await requireAdminUsersPanel();
    const resolvedAdminId = await resolveAdminUserId(adminUserId);
    const userId = formData.get("userId") as string;
    const strategy = (formData.get("strategy") as string) || null;
    if (strategy && !CONFIG_SUMMARY_STRATEGIES.includes(strategy as ConfigSummaryStrategy)) {
      throw new Error("Invalid strategy");
    }
    const commissionRaw = (formData.get("commissionPtsRoundTrip") as string) ?? "";
    const symbolsRaw = (formData.get("symbols") as string) ?? "";

    await saveConfigSummary(
      userId,
      {
        broker: ((formData.get("broker") as string) ?? "").trim() || null,
        accountType: ((formData.get("accountType") as string) ?? "").trim() || null,
        commissionPtsRoundTrip: commissionRaw.trim() === "" ? null : Math.round(Number(commissionRaw)),
        fastFeedProvider: ((formData.get("fastFeedProvider") as string) ?? "").trim() || null,
        symbols: symbolsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        strategy: strategy as ConfigSummaryStrategy | null,
        configJson: parseConfigParamsText((formData.get("configParams") as string) ?? ""),
        notes: ((formData.get("notes") as string) ?? "").trim() || null,
      },
      "admin_verified",
      resolvedAdminId
    );
    await logAdminAction(adminUserId, "admin_users_update_config_summary", userId, null, null);
    revalidateUsers(userId);
  });
}

export async function issueNewLicenseAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to issue license", async () => {
    const adminUserId = await requireAdminUsersPanel();
    const userId = formData.get("userId") as string;
    const expiresAt = resolveExpiresAt(parseDurationFormData(formData));
    const feedTypes = readFeedTypesFromFormData(formData);
    const tierRaw = formData.get("tier") as string | null;
    if (tierRaw && !LICENSE_TIERS.includes(tierRaw as LicenseTier)) throw new Error("Invalid tier");
    const tier = (tierRaw as LicenseTier) || undefined;
    const license = await issueLicense({ userId, expiresAt, feedTypes, tier });
    await logAdminAction(
      adminUserId,
      "admin_users_issue_license",
      userId,
      { licenseId: license.id, expiresAt: expiresAt.toISOString(), feedTypes, tier: tier ?? "paid" },
      license.id
    );

    const target = await getGroupTarget(userId);
    if (target) {
      const config = await getPortalConfig();
      await notifyUser(
        { telegramUserId: target.telegramUserId, email: target.email },
        "Your Horizon HFT license is ready",
        `Your license key: ${license.licenseKey}\n\nLog in at horizonhft.com to download the installer and view full docs.\nCommunity: ${config.communityGroupUrl}`
      );
      if (isPaidTier(tier ?? "paid")) {
        await sendPaidGroupInvite(target);
      }
    }

    revalidateUsers(userId);
  });
}

/** Deliberate second-sale path — distinct from issueNewLicenseAction, which refuses when the
 * user already has an active license. Delivers the new key the same way a first activation
 * does, but deliberately skips sendPaidGroupInvite: that function has no dedup guard against
 * an existing group_memberships row, and by construction a user reaching this action already
 * holds an active license, so is very likely already a paid-group member — inviting again
 * would insert a duplicate row and re-send a redundant DM. Not fixed here; flagged separately. */
export async function issueAdditionalLicenseAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to issue additional license", async () => {
    const adminUserId = await requireAdminUsersPanel();
    const userId = formData.get("userId") as string;
    const expiresAt = resolveExpiresAt(parseDurationFormData(formData));
    const feedTypes = readFeedTypesFromFormData(formData);
    const tierRaw = formData.get("tier") as string | null;
    if (tierRaw && !LICENSE_TIERS.includes(tierRaw as LicenseTier)) throw new Error("Invalid tier");
    const tier = (tierRaw as LicenseTier) || undefined;
    const license = await issueAdditionalLicense({ userId, expiresAt, feedTypes, tier });
    await logAdminAction(
      adminUserId,
      "admin_users_issue_additional_license",
      userId,
      { licenseId: license.id, expiresAt: expiresAt.toISOString(), feedTypes, tier: tier ?? "paid" },
      license.id
    );

    const target = await getGroupTarget(userId);
    if (target) {
      const config = await getPortalConfig();
      await notifyUser(
        { telegramUserId: target.telegramUserId, email: target.email },
        "Your additional Horizon HFT license is ready",
        `Your license key: ${license.licenseKey}\n\nLog in at horizonhft.com to download the installer and view full docs.\nCommunity: ${config.communityGroupUrl}`
      );
    }

    revalidateUsers(userId);
  });
}
