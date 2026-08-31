"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  issueLicense,
  extendLicense,
  revokeLicenseAndSyncGroup,
  listClients,
  getGroupTarget,
  getLicenseExpiresAt,
  LICENSE_TIERS,
  type LicenseTier,
} from "@/lib/licenses";
import { parseDurationFormData, resolveExpiresAt } from "@/lib/duration";
import { sendPaidGroupInvite, removeFromPaidGroup } from "@/lib/group-membership";
import { logAdminAction } from "@/lib/admin";
import { notifyUser } from "@/lib/notify";
import { getPortalConfig } from "@/lib/portal-config";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
  return session as typeof session & { user: { id: string } };
}

export async function issueLicenseAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to issue license", async () => {
    const session = await requireAdmin();
    const userId = (formData.get("userId") as string | null) || undefined;
    const email = (formData.get("email") as string | null) || undefined;
    const telegramUserIdRaw = (formData.get("telegramUserId") as string | null) || undefined;
    const expiresAt = resolveExpiresAt(parseDurationFormData(formData));
    const tierRaw = (formData.get("tier") as string | null) || undefined;
    if (tierRaw && !LICENSE_TIERS.includes(tierRaw as LicenseTier)) throw new Error("Invalid tier");
    const tier = tierRaw as LicenseTier | undefined;

    const license = await issueLicense({
      userId,
      claimEmail: !userId ? email : undefined,
      claimTelegramUserId: !userId && telegramUserIdRaw ? Number(telegramUserIdRaw) : undefined,
      expiresAt,
      tier,
    });

    await logAdminAction(session.user.id, "issue_license", userId ?? null, {
      licenseId: license.id,
      tier: tier ?? "paid",
    });

    if (userId) {
      const client = (await listClients()).find((c) => c.userId === userId);
      const config = await getPortalConfig();
      await notifyUser(
        { telegramUserId: client?.telegramUserId, email: client?.email },
        "Your Horizon HFT license is ready",
        `Your HH${license.licenseNumber} license key: ${license.licenseKey}\n\nLog in at horizonhft.com to download the installer and view full docs.\nCommunity: ${config.communityGroupUrl}`
      );
      const target = await getGroupTarget(userId);
      if (target) await sendPaidGroupInvite(target);
    }

    revalidatePath("/admin");
  });
}

export async function extendLicenseAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to extend license", async () => {
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
  });
}

export async function revokeLicenseAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to revoke license", async () => {
    const session = await requireAdmin();
    const licenseId = formData.get("licenseId") as string;
    await revokeLicenseAndSyncGroup(licenseId);
    await logAdminAction(session.user.id, "revoke_license", null, { licenseId });

    revalidatePath("/admin");
  });
}

export async function resendGroupInviteAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to resend invite", async () => {
    const session = await requireAdmin();
    const userId = formData.get("userId") as string;
    const target = await getGroupTarget(userId);
    const result = target ? await sendPaidGroupInvite(target) : { sent: false as const, reason: "invite_link_failed" as const };
    await logAdminAction(session.user.id, "resend_group_invite", userId, result);
    revalidatePath("/admin");
  });
}

export async function forceRemoveGroupAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to remove from group", async () => {
    const session = await requireAdmin();
    const userId = formData.get("userId") as string;
    const target = await getGroupTarget(userId);
    if (target?.telegramUserId) await removeFromPaidGroup(target.userId, target.telegramUserId);
    await logAdminAction(session.user.id, "force_remove_group", userId, null);
    revalidatePath("/admin");
  });
}

export async function resendWelcomeAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to resend welcome message", async () => {
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
  });
}
