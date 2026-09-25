"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isFeedProviderUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { submitProposalRound } from "@/lib/provider-tier-proposals";
import { parseEndpointsJson } from "@/lib/provider-tier-endpoints";

async function requireProviderId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isFeedProviderUser(session.user)) {
    throw new Error("You must be signed in as a feed provider");
  }
  return session.user.id;
}

function str(formData: FormData, key: string): string | null {
  const value = ((formData.get(key) as string) ?? "").trim();
  return value || null;
}

function list(formData: FormData, key: string): string[] | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const parts = raw
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : null;
}

export async function submitTierProposalAction(formData: FormData): Promise<ActionResult> {
  return runAction("Failed to submit terms", async () => {
    const providerUserId = await requireProviderId();
    const applicationId = (formData.get("applicationId") as string)?.trim();
    if (!applicationId) throw new Error("Missing application");

    const clientPriceCents = Math.round(parseFloat((formData.get("clientPrice") as string) ?? "") * 100);
    const providerSplitPct = parseInt((formData.get("providerSplitPct") as string) ?? "", 10);
    const trialLengthDaysRaw = (formData.get("trialLengthDays") as string)?.trim();
    const trialLengthDays = trialLengthDaysRaw ? parseInt(trialLengthDaysRaw, 10) : 14;

    // Adapter until the form posts N rows (code phase delta 4; marcus m54021, J1 = A): the four
    // single boxes become one endpoint row through the same parser the N-row form will use, so
    // its rules already apply here -- an all-blank row is no row, and a protocol or SenderCompID
    // with no host and port is refused, naming the missing box (docs/specs/0091-tier-endpoints-
    // design.md @ 6100dc0, section 2.1 :104-115: a tightening versus the four independent
    // inputs this replaces, stated on purpose).
    const endpoints = parseEndpointsJson(
      JSON.stringify([
        {
          protocol: str(formData, "protocol"),
          endpointHost: str(formData, "endpointHost"),
          endpointPort: str(formData, "endpointPort"),
          compid: str(formData, "compid"),
        },
      ])
    );

    await submitProposalRound(providerUserId, applicationId, {
      tierName: (formData.get("tierName") as string) ?? "",
      clientPriceCents,
      providerSplitPct,
      trialLengthDays,
      endpoints,
      regions: list(formData, "regions"),
      coverage: list(formData, "coverage"),
    });

    revalidatePath("/feed/dashboard/terms");
  });
}
