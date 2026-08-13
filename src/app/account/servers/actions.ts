"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { runAction, type ActionResult } from "@/lib/action-result";
import { getLicenseForUser } from "@/lib/licenses";
import { saveServerRegistration, VPS_PROVIDERS, type VpsProvider } from "@/lib/server-registration";

async function requireLicenseId(): Promise<{ licenseId: string; email: string | null }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  const license = await getLicenseForUser(session.user.id);
  if (!license) throw new Error("No active license on this account");
  return { licenseId: license.id, email: session.user.email ?? null };
}

export async function saveServerRegistrationAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to save server registration", async () => {
    const { licenseId, email } = await requireLicenseId();

    const serverName = ((formData.get("serverName") as string) ?? "").trim();
    const vpsProvider = ((formData.get("vpsProvider") as string) ?? "").trim();
    const vpsProviderOther = ((formData.get("vpsProviderOther") as string) ?? "").trim() || null;
    const serverLocation = ((formData.get("serverLocation") as string) ?? "").trim();
    const declaredIp = ((formData.get("declaredIp") as string) ?? "").trim();

    if (!serverName) throw new Error("Server name is required");
    if (!VPS_PROVIDERS.includes(vpsProvider as VpsProvider)) throw new Error("Invalid VPS provider");
    if (vpsProvider === "other" && !vpsProviderOther) throw new Error("Please specify the VPS provider");
    if (!serverLocation) throw new Error("Server location is required");
    if (!declaredIp) throw new Error("Server IP is required");

    await saveServerRegistration(
      licenseId,
      { serverName, vpsProvider, vpsProviderOther, serverLocation, declaredIp },
      `/admin/connections?license=${licenseId}`,
      email
    );
    revalidatePath("/account/servers");
  });
}
