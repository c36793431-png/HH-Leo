"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { registerProviderTiers, type ApplicationFieldEdits, type RegisterTierInput } from "@/lib/provider-tiers";
import { createManualProviderApplication } from "@/lib/provider-applications";

function str(formData: FormData, key: string): string | null {
  const value = ((formData.get(key) as string) ?? "").trim();
  return value || null;
}

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
  return session.user.id;
}

function parseTiers(raw: string): RegisterTierInput[] {
  const parsed = JSON.parse(raw) as Array<{
    tierName: string;
    clientPrice: string;
    providerSplitPct: string;
    endpointHost: string;
    endpointPort: string;
    endpointVerified: boolean;
  }>;

  return parsed
    .filter((t) => t.tierName.trim().length > 0)
    .map((t) => {
      const clientPriceCents = Math.round(parseFloat(t.clientPrice) * 100);
      const providerSplitPct = parseInt(t.providerSplitPct, 10);
      if (!Number.isFinite(clientPriceCents) || clientPriceCents < 0) {
        throw new Error(`Invalid client price for tier "${t.tierName}"`);
      }
      if (!Number.isFinite(providerSplitPct) || providerSplitPct < 0 || providerSplitPct > 100) {
        throw new Error(`Invalid provider split for tier "${t.tierName}"`);
      }
      return {
        tierName: t.tierName.trim(),
        clientPriceCents,
        providerSplitPct,
        endpointHost: t.endpointHost.trim() || null,
        endpointPort: t.endpointPort.trim() || null,
        endpointVerified: !!t.endpointVerified,
      };
    });
}

export async function registerProviderAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to register provider", async () => {
    const adminUserId = await requireAdmin();
    let applicationId = (formData.get("applicationId") as string)?.trim() || "";
    const tiersRaw = (formData.get("tiersJson") as string) ?? "[]";
    const tiers = parseTiers(tiersRaw);
    const edits: ApplicationFieldEdits = {
      name: (formData.get("providerName") as string)?.trim() || "",
      contactName: str(formData, "contactName"),
      country: str(formData, "country"),
      timezone: str(formData, "timezone"),
      protocol: str(formData, "protocol"),
      host: str(formData, "host"),
      port: str(formData, "port"),
      compid: str(formData, "senderCompId"),
      coverage: str(formData, "assetClasses"),
      regions: str(formData, "regions"),
      tiersOffered: str(formData, "offeringDescription"),
    };
    if (!edits.name) throw new Error("Provider name is required");

    if (!applicationId) {
      const contactEmail = str(formData, "contactEmail");
      if (!contactEmail) throw new Error("Contact email is required for manual registration");
      const manual = await createManualProviderApplication({ name: edits.name, email: contactEmail }, adminUserId);
      applicationId = manual.id;
    }

    await registerProviderTiers(applicationId, tiers, edits);
    revalidatePath("/admin/register-provider");
    revalidatePath("/admin/provider-applications");
  });
}
