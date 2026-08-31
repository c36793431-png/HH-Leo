"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { runAction, type ActionResult } from "@/lib/action-result";
import { getActiveLicensesForUser, isPaidUser } from "@/lib/licenses";
import { saveServerRegistration, VPS_PROVIDERS, type VpsProvider, getServerRegistration } from "@/lib/server-registration";
import { isServerLocation } from "@/lib/server-locations";
import { requestBlackTrial, requestBlackTrialConversion } from "@/lib/black-trials";

/** Validates the caller-supplied licenseId against the signed-in user's own active licenses —
 * every action below takes an explicit licenseId (bound server-side in the page, one per
 * rendered card) instead of inferring "the" license, since a user can hold several. */
async function requireLicenseId(licenseId: string): Promise<{ licenseId: string; email: string | null }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  const licenses = await getActiveLicensesForUser(session.user.id);
  if (!licenses.some((l) => l.id === licenseId)) throw new Error("License not found on this account");
  return { licenseId, email: session.user.email ?? null };
}

export async function saveServerRegistrationAction(
  licenseId: string,
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to save server registration", async () => {
    const { licenseId: validLicenseId, email } = await requireLicenseId(licenseId);

    const serverName = ((formData.get("serverName") as string) ?? "").trim();
    const vpsProvider = ((formData.get("vpsProvider") as string) ?? "").trim();
    const vpsProviderOther = ((formData.get("vpsProviderOther") as string) ?? "").trim() || null;
    const location = ((formData.get("location") as string) ?? "").trim();
    const declaredIp = ((formData.get("declaredIp") as string) ?? "").trim();

    if (!serverName) throw new Error("Server name is required");
    if (!VPS_PROVIDERS.includes(vpsProvider as VpsProvider)) throw new Error("Invalid VPS provider");
    if (vpsProvider === "other" && !vpsProviderOther) throw new Error("Please specify the VPS provider");
    if (!isServerLocation(location)) throw new Error("Server location is required");
    if (!declaredIp) throw new Error("Server IP is required");

    await saveServerRegistration(
      validLicenseId,
      { serverName, vpsProvider, vpsProviderOther, location, declaredIp },
      `https://portal.horizonhft.com/admin/connections/${validLicenseId}`,
      email
    );
    revalidatePath("/account/servers");
  });
}

export async function requestBlackTrialAction(licenseId: string): Promise<ActionResult> {
  return runAction("Failed to request Black trial", async () => {
    const session = await auth();
    if (!session?.user?.id) throw new Error("Not signed in");

    const paid = await isPaidUser(session.user.id).catch(() => false);
    if (!paid) throw new Error("Black trial is available to paid users.");

    const { licenseId: validLicenseId } = await requireLicenseId(licenseId);
    const registration = await getServerRegistration(validLicenseId).catch(() => null);
    if (!registration) throw new Error("Register your server before requesting a Black trial.");

    await requestBlackTrial({ userId: session.user.id, licenseId: validLicenseId, adminUrl: `/admin/black-trials` });
    revalidatePath("/account/servers");
  });
}

export async function requestBlackTrialConvertAction(licenseId: string): Promise<ActionResult> {
  return runAction("Failed to request conversion", async () => {
    const { licenseId: validLicenseId } = await requireLicenseId(licenseId);
    await requestBlackTrialConversion(validLicenseId);
    revalidatePath("/account/servers");
  });
}
