"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  issueLicense,
  extendLicense,
  revokeLicense,
  listClients,
  getGroupTarget,
  getLicenseExpiresAt,
} from "@/lib/licenses";
import { parseDurationFormData, resolveExpiresAt } from "@/lib/duration";
import { sendPaidGroupInvite, removeFromPaidGroup } from "@/lib/group-membership";
import { logAdminAction } from "@/lib/admin";
import { notifyUser } from "@/lib/notify";
import { getPortalConfig } from "@/lib/portal-config";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id || !isAdminUsersPanelEmail(session.user.email)) throw new Error("forbidden");
  return session as typeof session & { user: { id: string } };
}

export async function issueLicenseAction(formData: FormData) {
  const session = await requireAdmin();
  const userId = (formData.get("userId") as string | null) || undefined;
  const email = (formData.get("email") as string | null) || undefined;
  const telegramUserIdRaw = (formData.get("telegramUserId") as string | null) || undefined;
  const expiresAt = resolveExpiresAt(parseDurationFormData(formData));

  const license = await issueLicense({
    userId,
    claimEmail: !userId ? email : undefined,
    claimTelegramUserId: !userId && telegramUserIdRaw ? Number(telegramUserIdRaw) : undefined,
    expiresAt,
  });

  await logAdminAction(session.user.id, "issue_license", userId ?? null, { licenseId: license.id });

  if (userId) {
    const client = (await listClients()).find((c) => c.userId === userId);
    const config = await getPortalConfig();
    await notifyUser(
      { telegramUserId: client?.telegramUserId, email: client?.email },
      "Your Horizon HFT license is ready",
      `Your license key: ${license.licenseKey}\n\nLog in at horizonhft.com to download the installer and view full docs.\nCommunity: ${config.communityGroupUrl}`
    );
    const target = await getGroupTarget(userId);
    if (target) await sendPaidGroupInvite(target);
  }

  revalidatePath("/admin");
}

export async function extendLicenseAction(formData: FormData) {
  const session = await requireAdmin();
  const licenseId = formData.get("licenseId") as string;
  const userId = (formData.get("userId") as string | null) || undefined;
  const current = await getLicenseExpiresAt(licenseId);
  const expiresAt = resolveExpiresAt(parseDurationFormData(formData), current);
  await extendLicense(licenseId, expiresAt);
  await logAdminAction(session.user.id, "extend_license", null, { licenseId, expiresAt: expiresAt.toISOString() });

  if (userId) {
    const target = await getGroupTarget(userId);
    if (target) await sendPaidGroupInvite(target);
  }

  revalidatePath("/admin");
}

export async function revokeLicenseAction(formData: FormData) {
  const session = await requireAdmin();
  const licenseId = formData.get("licenseId") as string;
  const userId = (formData.get("userId") as string | null) || undefined;
  await revokeLicense(licenseId);
  await logAdminAction(session.user.id, "revoke_license", null, { licenseId });

  if (userId) {
    const target = await getGroupTarget(userId);
    if (target?.telegramUserId) await removeFromPaidGroup(target.telegramUserId);
  }

  revalidatePath("/admin");
}

export async function resendGroupInviteAction(formData: FormData) {
  const session = await requireAdmin();
  const userId = formData.get("userId") as string;
  const target = await getGroupTarget(userId);
  const result = target ? await sendPaidGroupInvite(target) : { sent: false as const, reason: "invite_link_failed" as const };
  await logAdminAction(session.user.id, "resend_group_invite", userId, result);
  revalidatePath("/admin");
}

export async function forceRemoveGroupAction(formData: FormData) {
  const session = await requireAdmin();
  const userId = formData.get("userId") as string;
  const target = await getGroupTarget(userId);
  if (target?.telegramUserId) await removeFromPaidGroup(target.telegramUserId);
  await logAdminAction(session.user.id, "force_remove_group", userId, null);
  revalidatePath("/admin");
}

export async function resendWelcomeAction(formData: FormData) {
  const session = await requireAdmin();
  const userId = formData.get("userId") as string;
  const client = (await listClients()).find((c) => c.userId === userId);
  if (client) {
    const config = await getPortalConfig();
    await notifyUser(
      { telegramUserId: client.telegramUserId, email: client.email },
      "Welcome back to Horizon HFT",
      `Community: ${config.communityGroupUrl}\nLog in at horizonhft.com any time to view your account.`
    );
  }
  await logAdminAction(session.user.id, "resend_welcome", userId, null);
  revalidatePath("/admin");
}

