"use server";

import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { issueLicense, extendLicense, revokeLicense, listClients, getGroupTarget } from "@/lib/licenses";
import { sendPaidGroupInvite, removeFromPaidGroup } from "@/lib/group-membership";
import { logAdminAction } from "@/lib/admin";
import { notifyUser } from "@/lib/notify";
import { getPortalConfig, setInstallerInfo } from "@/lib/portal-config";

async function requireAdmin() {
  const session = await auth();
  if (session?.user?.role !== "admin" || !session.user.id) throw new Error("forbidden");
  return session as typeof session & { user: { id: string } };
}

export async function issueLicenseAction(formData: FormData) {
  const session = await requireAdmin();
  const userId = (formData.get("userId") as string | null) || undefined;
  const email = (formData.get("email") as string | null) || undefined;
  const telegramUserIdRaw = (formData.get("telegramUserId") as string | null) || undefined;

  const license = await issueLicense({
    userId,
    claimEmail: !userId ? email : undefined,
    claimTelegramUserId: !userId && telegramUserIdRaw ? Number(telegramUserIdRaw) : undefined,
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
  const days = Number(formData.get("days") ?? 30);
  await extendLicense(licenseId, days);
  await logAdminAction(session.user.id, "extend_license", null, { licenseId, days });

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

export async function uploadInstallerAction(formData: FormData) {
  const session = await requireAdmin();
  const file = formData.get("file");
  const version = formData.get("version");
  const changelog = (formData.get("changelog") as string | null) || undefined;
  if (!(file instanceof File) || typeof version !== "string" || !version) {
    throw new Error("file and version are required");
  }

  const blob = await put(`installers/${version}/${file.name}`, file, { access: "public" });
  await setInstallerInfo({
    blobUrl: blob.url,
    filename: file.name,
    version,
    changelog,
    uploadedAt: new Date().toISOString(),
  });
  await logAdminAction(session.user.id, "upload_installer", null, { version, filename: file.name });

  const paidClients = (await listClients()).filter((c) => c.paid);
  await Promise.all(
    paidClients.map((c) =>
      notifyUser(
        { telegramUserId: c.telegramUserId, email: c.email },
        "Horizon HFT update available",
        `A new build (v${version}) is available. Log in to horizonhft.com to download it.`
      )
    )
  );

  revalidatePath("/admin");
}
