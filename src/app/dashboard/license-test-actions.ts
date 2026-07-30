"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { expireLicenseNow, extendLicense, revokeLicense } from "@/lib/licenses";
import { isCoxwellTestUserEmail } from "@/lib/coxwell-test-admin";

/** Coxwell-only license lifecycle test buttons — DB updates only, no notification
 * side-effects (bus thread horizon-portal-license-status-widget-2026-07-26). */
async function requireCoxwellTestUserLicenseId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isCoxwellTestUserEmail(session.user.email)) {
    throw new Error("forbidden");
  }
  const result = await pool.query<{ id: string }>(
    `select id from licenses where user_id = $1 order by issued_at desc limit 1`,
    [session.user.id]
  );
  const licenseId = result.rows[0]?.id;
  if (!licenseId) throw new Error("No license found for this account");
  return licenseId;
}

export async function expireTestLicenseNowAction(): Promise<void> {
  const licenseId = await requireCoxwellTestUserLicenseId();
  await expireLicenseNow(licenseId);
  revalidatePath("/dashboard");
}

export async function extendTestLicense30dAction(): Promise<void> {
  const licenseId = await requireCoxwellTestUserLicenseId();
  await extendLicense(licenseId, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  revalidatePath("/dashboard");
}

export async function revokeTestLicenseAction(): Promise<void> {
  const licenseId = await requireCoxwellTestUserLicenseId();
  await revokeLicense(licenseId);
  revalidatePath("/dashboard");
}
