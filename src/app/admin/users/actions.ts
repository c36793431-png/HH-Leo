"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { issueLicense, extendLicense, revokeLicense } from "@/lib/licenses";
import { logAdminAction } from "@/lib/admin";
import { ADMIN_USERS_PANEL_EMAIL } from "@/lib/admin-users-panel";

async function requireAdminUsersPanel(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.email !== ADMIN_USERS_PANEL_EMAIL) {
    throw new Error("forbidden");
  }
  return session.user.id;
}

export async function expireNowAction(formData: FormData) {
  const adminUserId = await requireAdminUsersPanel();
  const licenseId = formData.get("licenseId") as string;
  await pool.query("update licenses set expires_at = now() where id = $1", [licenseId]);
  await logAdminAction(adminUserId, "admin_users_expire_now", null, { licenseId });
  revalidatePath("/admin/users");
}

export async function extend30Action(formData: FormData) {
  const adminUserId = await requireAdminUsersPanel();
  const licenseId = formData.get("licenseId") as string;
  await extendLicense(licenseId, 30);
  await logAdminAction(adminUserId, "admin_users_extend_30d", null, { licenseId });
  revalidatePath("/admin/users");
}

export async function revokeAction(formData: FormData) {
  const adminUserId = await requireAdminUsersPanel();
  const licenseId = formData.get("licenseId") as string;
  await revokeLicense(licenseId);
  await logAdminAction(adminUserId, "admin_users_revoke", null, { licenseId });
  revalidatePath("/admin/users");
}

export async function issueNewLicenseAction(formData: FormData) {
  const adminUserId = await requireAdminUsersPanel();
  const userId = formData.get("userId") as string;
  const license = await issueLicense({ userId, ttlDays: 30 });
  await logAdminAction(adminUserId, "admin_users_issue_license", userId, { licenseId: license.id });
  revalidatePath("/admin/users");
}
