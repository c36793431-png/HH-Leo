"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { extendLicense, revokeLicense, getLicenseExpiresAt } from "@/lib/licenses";
import { parseDurationFormData, resolveExpiresAt } from "@/lib/duration";
import { logAdminAction } from "@/lib/admin";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";

async function requireAdminUsersPanel(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUsersPanelEmail(session.user.email)) {
    throw new Error("forbidden");
  }
  return session.user.id;
}

function revalidateLicenses(userId?: string | null) {
  revalidatePath("/admin/licenses");
  revalidatePath("/admin/users");
  if (userId) revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/history");
}

async function getLicenseOwner(licenseId: string): Promise<string | null> {
  const result = await pool.query<{ user_id: string | null }>(
    "select user_id from licenses where id = $1",
    [licenseId]
  );
  return result.rows[0]?.user_id ?? null;
}

export async function extendLicenseFromListAction(
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
    await logAdminAction(adminUserId, "admin_licenses_extend", ownerId, { licenseId, expiresAt: expiresAt.toISOString() }, licenseId);
    revalidateLicenses(ownerId);
  });
}

export async function revokeLicenseFromListAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to revoke license", async () => {
    const adminUserId = await requireAdminUsersPanel();
    const licenseId = formData.get("licenseId") as string;
    const ownerId = await getLicenseOwner(licenseId);
    await revokeLicense(licenseId);
    await logAdminAction(adminUserId, "admin_licenses_revoke", ownerId, { licenseId }, licenseId);
    revalidateLicenses(ownerId);
  });
}
