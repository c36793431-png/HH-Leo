"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { issueLicense, extendLicense, revokeLicense } from "@/lib/licenses";
import { logAdminAction } from "@/lib/admin";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";

async function requireAdminUsersPanel(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUsersPanelEmail(session.user.email)) {
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

export async function expireNowAction(formData: FormData) {
  const adminUserId = await requireAdminUsersPanel();
  const licenseId = formData.get("licenseId") as string;
  const ownerId = await getLicenseOwner(licenseId);
  await pool.query("update licenses set expires_at = now() where id = $1", [licenseId]);
  await logAdminAction(adminUserId, "admin_users_expire_now", ownerId, { licenseId }, licenseId);
  revalidateUsers(ownerId);
}

export async function extend30Action(formData: FormData) {
  const adminUserId = await requireAdminUsersPanel();
  const licenseId = formData.get("licenseId") as string;
  const ownerId = await getLicenseOwner(licenseId);
  await extendLicense(licenseId, 30);
  await logAdminAction(adminUserId, "admin_users_extend_30d", ownerId, { licenseId }, licenseId);
  revalidateUsers(ownerId);
}

export async function revokeAction(formData: FormData) {
  const adminUserId = await requireAdminUsersPanel();
  const licenseId = formData.get("licenseId") as string;
  const ownerId = await getLicenseOwner(licenseId);
  await revokeLicense(licenseId);
  await logAdminAction(adminUserId, "admin_users_revoke", ownerId, { licenseId }, licenseId);
  revalidateUsers(ownerId);
}

export async function issueNewLicenseAction(formData: FormData) {
  const adminUserId = await requireAdminUsersPanel();
  const userId = formData.get("userId") as string;
  const license = await issueLicense({ userId, ttlDays: 30 });
  await logAdminAction(adminUserId, "admin_users_issue_license", userId, { licenseId: license.id }, license.id);
  revalidateUsers(userId);
}
