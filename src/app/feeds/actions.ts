"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createFeedRequest } from "@/lib/feed-requests";
import { createFeedTierRequest } from "@/lib/feed-tier-requests";
import { joinTierWaitlist } from "@/lib/tier-waitlist";
import { feedTierMeta, isFeedRegion } from "@/lib/feed-tier-catalogue";
import { getActiveLicenseForUser, getActiveLicensesForUser } from "@/lib/licenses";
import { getServerRegistration } from "@/lib/server-registration";
import { runAction, type ActionResult } from "@/lib/action-result";
import { startFeedTierTrial, cancelFeedTierTrial, getFeedTierTrial } from "@/lib/feed-tier-trials";

export async function submitFeedRequestAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to submit request", async () => {
    const session = await auth();
    if (!session?.user?.id) throw new Error("You must be signed in to request a feed");

    const venueText = ((formData.get("venueText") as string) ?? "").trim();
    const useCaseText = ((formData.get("useCaseText") as string) ?? "").trim();
    const preferredLocation = ((formData.get("preferredLocation") as string) ?? "").trim() || null;

    if (!venueText) throw new Error("Tell us which feed or venue you need");
    if (!useCaseText) throw new Error("Tell us what you're trying to trade, hedge, or arb");

    await createFeedRequest({ userId: session.user.id, venueText, useCaseText, preferredLocation });
  });
}

/** Backend for the tier-signup flow (region + tier -> admin review queue), wired to the
 * TierRequestControl modal. Cross-region binding is legitimate (coxwell,
 * leo-cross-region-server-picker-2026-09-04: "yes they can if they wish"), so the client
 * picks which registered server the request is for and this only re-checks that the
 * submitted server/licence actually belongs to them -- ownership must be enforced
 * server-side, never trusted from the form. */
export async function submitFeedTierRequestAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to submit feed request", async () => {
    const session = await auth();
    if (!session?.user?.id) throw new Error("You must be signed in to request feed access");

    const region = (formData.get("region") as string) ?? "";
    const tierKey = (formData.get("tierKey") as string) ?? "";
    const licenseId = (formData.get("licenseId") as string) ?? "";
    if (!isFeedRegion(region)) throw new Error("Invalid region");
    const tier = feedTierMeta(tierKey);
    if (!tier || tier.region !== region) throw new Error("Invalid tier");
    if (!licenseId) throw new Error("Select a server");

    const licenses = await getActiveLicensesForUser(session.user.id);
    const license = licenses.find((l) => l.id === licenseId);
    if (!license) throw new Error("Invalid server selection");

    const serverRegistration = await getServerRegistration(licenseId);
    if (!serverRegistration) throw new Error("No server registered on that license");

    await createFeedTierRequest({
      userId: session.user.id,
      licenseId: license.id,
      region,
      tierKey,
      adminUrl: "https://feed.horizonhft.com/admin/feed-tier-requests",
    });
    revalidatePath("/feeds");
  });
}

/** Black isn't in feed-tier-catalogue.ts (see page.tsx BLACK_TIER comment), so this
 * doesn't reuse submitFeedTierRequestAction's feedTierMeta lookup -- validates the one
 * region/tier combo the waitlist supports directly instead
 * (leo-tiers-black-coming-soon-waitlist-2026-08-21). */
export async function joinBlackWaitlistAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to join waitlist", async () => {
    const session = await auth();
    if (!session?.user?.id) throw new Error("You must be signed in to join the waitlist");

    const region = (formData.get("region") as string) ?? "";
    const tierKey = (formData.get("tierKey") as string) ?? "";
    if (region !== "london" || tierKey !== "black") throw new Error("Invalid tier");

    await joinTierWaitlist({
      userId: session.user.id,
      region,
      tierKey,
      tierName: "Black",
    });
    revalidatePath(`/feeds/${region}/tiers`);
  });
}

export type StartTrialResult =
  | { ok: true; trialId: string; endsAt: string }
  | { ok: false; error: string };

/** Trial CTA on the LD Alpha / LD Ultra tier-detail cards (marcus, horizon-portal-v2051-polish
 * trial add-on). Wraps the lib/feed-tier-trials.ts functions shipped in 4f6ab0b. Returns the
 * created trial's id/endsAt (unlike the generic ActionResult) so the client can render the
 * countdown + wire the cancel button without a page reload. */
export async function startFeedTierTrialAction(
  _prevState: StartTrialResult | null,
  formData: FormData
): Promise<StartTrialResult> {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new Error("You must be signed in to start a trial");

    const region = (formData.get("region") as string) ?? "";
    const tierKey = (formData.get("tierKey") as string) ?? "";
    if (!isFeedRegion(region)) throw new Error("Invalid region");
    const tier = feedTierMeta(tierKey);
    if (!tier || tier.region !== region) throw new Error("Invalid tier");

    const license = await getActiveLicenseForUser(session.user.id);
    if (!license) throw new Error("No active license on this account");

    const trial = await startFeedTierTrial({
      userId: session.user.id,
      licenseId: license.id,
      region,
      tierKey,
      adminUrl: "https://feed.horizonhft.com/admin/feed-tier-trials",
    });
    revalidatePath(`/feeds/${region}/tiers`);
    return { ok: true, trialId: trial.id, endsAt: trial.trialEndsAt.toISOString() };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.message ? err.message : "Failed to start trial" };
  }
}

export async function cancelFeedTierTrialAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to cancel trial", async () => {
    const session = await auth();
    if (!session?.user?.id) throw new Error("You must be signed in");

    const trialId = (formData.get("trialId") as string) ?? "";
    const trial = await getFeedTierTrial(trialId);
    if (!trial || trial.userId !== session.user.id) throw new Error("Trial not found");

    await cancelFeedTierTrial(trialId);
    revalidatePath(`/feeds/${trial.region}/tiers`);
  });
}
