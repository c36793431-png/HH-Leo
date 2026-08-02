"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import {
  issueLicense,
  extendLicense,
  revokeLicense,
  getLicenseExpiresAt,
  setLicenseTier,
  setLicenseFeedTypes,
  LICENSE_TIERS,
  FEED_TYPES,
  type LicenseTier,
  type FeedType,
} from "@/lib/licenses";
import { parseDurationFormData, resolveExpiresAt } from "@/lib/duration";
import { logAdminAction } from "@/lib/admin";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";

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
    await revokeLicense(licenseId);
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

const ADMIN_EDITABLE_USER_FIELDS = ["display_name", "email", "role"] as const;
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
    if (field === "role" && value !== "user" && value !== "admin") {
      throw new Error("Invalid role");
    }
    if (field === "email" && value === "") {
      throw new Error("Email is required");
    }
    const nextValue = field === "display_name" && value === "" ? null : value;

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

export async function issueNewLicenseAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to issue license", async () => {
    const adminUserId = await requireAdminUsersPanel();
    const userId = formData.get("userId") as string;
    const expiresAt = resolveExpiresAt(parseDurationFormData(formData));
    const feedTypes = readFeedTypesFromFormData(formData);
    const license = await issueLicense({ userId, expiresAt, feedTypes });
    await logAdminAction(
      adminUserId,
      "admin_users_issue_license",
      userId,
      { licenseId: license.id, expiresAt: expiresAt.toISOString(), feedTypes },
      license.id
    );
    revalidateUsers(userId);
  });
}
