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

    // Section 1 row 2 (docs/specs/0091-tier-endpoints-design.md @ 6100dc0, :38): the form posts
    // its endpoint rows as one JSON list in a hidden input (serializeEndpointRows in the
    // component), and the parser owns every rule -- all-blank rows are skipped, positions are
    // 0..n-1 in form order, at most 8, a row needs host AND port (2.1, :104-115), and a repeated
    // identity is refused by row number. Nothing here reads a connection box by name any more.
    const endpoints = parseEndpointsJson((formData.get("endpointsJson") as string | null) ?? null);

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
