"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { runAction, type ActionResult } from "@/lib/action-result";
import { getActiveLicensesForUser, isPaidUser } from "@/lib/licenses";
import {
  saveServerRegistration,
  updateServerRegistrationById,
  VPS_PROVIDERS,
  type VpsProvider,
  type ServerRegistrationInput,
  getServerRegistration,
} from "@/lib/server-registration";
import { isServerLocation } from "@/lib/server-locations";
import { requestBlackTrial, requestBlackTrialConversion } from "@/lib/black-trials";

/** Validates the caller-supplied licenseId against the signed-in user's own active licenses —
 * every action below takes an explicit licenseId (bound server-side in the page, one per
 * rendered card) instead of inferring "the" license, since a user can hold several. */
async function requireLicenseId(licenseId: string): Promise<{ licenseId: string; userId: string; email: string | null }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  const licenses = await getActiveLicensesForUser(session.user.id);
  if (!licenses.some((l) => l.id === licenseId)) throw new Error("License not found on this account");
  // userId is returned, not re-derived from the licence, because this check has already
  // established they are the same person: getActiveLicensesForUser filters on
  // licenses.user_id. server_registrations.user_id (0086) is written from it.
  return { licenseId, userId: session.user.id, email: session.user.email ?? null };
}

/** Shared by the register and edit actions so the two paths cannot drift on validation --
 * they submit the same form (server-registration-form.tsx), they only differ in what they
 * key the write on. Lifted verbatim out of saveServerRegistrationAction; no rule changed. */
function parseRegistrationInput(formData: FormData): ServerRegistrationInput {
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

  return { serverName, vpsProvider, vpsProviderOther, location, declaredIp };
}

/** REGISTER path only -- the licence is still what a not-yet-existing server is created
 * against, so this one keeps taking a licenseId and keeps going through requireLicenseId.
 * Editing an existing server goes through updateServerRegistrationAction below. */
export async function saveServerRegistrationAction(
  licenseId: string,
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to save server registration", async () => {
    const { licenseId: validLicenseId, userId, email } = await requireLicenseId(licenseId);
    const input = parseRegistrationInput(formData);

    await saveServerRegistration(
      validLicenseId,
      userId,
      input,
      `https://portal.horizonhft.com/admin/connections/${validLicenseId}`,
      email
    );
    revalidatePath("/account/servers");
  });
}

/** EDIT path, keyed on the server row's id rather than its licence. requireLicenseId is
 * deliberately NOT used here: it authorises a licence, and after the re-key the thing
 * being written is a server. The ownership check moves into the UPDATE itself
 * (`where id = $1 and user_id = $2`, see updateServerRegistrationById) so that holding a
 * row's uuid is not on its own enough to edit it. */
export async function updateServerRegistrationAction(
  registrationId: string,
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to save server registration", async () => {
    const session = await auth();
    if (!session?.user?.id) throw new Error("Not signed in");
    const input = parseRegistrationInput(formData);

    const updated = await updateServerRegistrationById(registrationId, session.user.id, input);
    if (!updated) throw new Error("Server not found on this account");
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

    await requestBlackTrial({ userId: session.user.id, licenseId: validLicenseId, adminUrl: "https://feed.horizonhft.com/admin/black-trials" });
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
