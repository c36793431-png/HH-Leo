"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { registerProviderTiers, type ApplicationFieldEdits, type RegisterTierInput } from "@/lib/provider-tiers";
import { createManualProviderApplication } from "@/lib/provider-applications";
import { parseEndpointsJson, serializeEndpointRows, type EndpointInput } from "@/lib/provider-tier-endpoints";

function str(formData: FormData, key: string): string | null {
  const value = ((formData.get(key) as string) ?? "").trim();
  return value || null;
}

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
  return session.user.id;
}

/** One entry per line. Deliberately not the terms form's comma split: an admin-typed entry can
 * carry its own commas -- "CME futures (GLBX.MDP3, 13 symbols, MBP-1)" is one coverage item,
 * not three. The input's hint states the rule, so the delimiter is chosen at entry, not guessed. */
function lines(raw: string | undefined): string[] | null {
  const parts = (raw ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : null;
}

function parseTiers(raw: string): RegisterTierInput[] {
  const parsed = JSON.parse(raw) as Array<{
    tierName: string;
    clientPrice: string;
    providerSplitPct: string;
    endpointHost: string;
    endpointPort: string;
    endpointVerified: boolean;
    protocol?: string;
    regions?: string;
    coverage?: string;
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
      // Section 1 row 8 (docs/specs/0091-tier-endpoints-design.md @ 6100dc0, :44; 2.2 :178-179):
      // the tier's host/port/protocol are one endpoint row at position 0, read through the same
      // parser as the terms form, so its rules hold here too -- all blank is no row, a protocol
      // with no address is refused naming the missing box (2.1 S1, :104-115; a tightening versus
      // the three independent inputs this replaces), and no compid by design (ruling (c)). The
      // draft goes through the serializer first so a numeric value cannot reach the parser as a
      // "must be text" refusal (fable's delta-1 note N3, m54026 via marcus m54028).
      let endpoints: EndpointInput[];
      try {
        endpoints = parseEndpointsJson(
          serializeEndpointRows([{ protocol: t.protocol, endpointHost: t.endpointHost, endpointPort: t.endpointPort }])
        );
      } catch (err) {
        throw new Error(`Tier "${t.tierName.trim()}": ${err instanceof Error ? err.message : String(err)}`);
      }
      return {
        tierName: t.tierName.trim(),
        clientPriceCents,
        providerSplitPct,
        endpoint: endpoints[0] ?? null,
        endpointVerified: !!t.endpointVerified,
        regions: lines(t.regions),
        coverage: lines(t.coverage),
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
