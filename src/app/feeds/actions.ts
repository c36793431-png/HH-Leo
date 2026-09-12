"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createFeedRequest } from "@/lib/feed-requests";
import { createFeedTierRequest, startSelfServeFeedTierTrial } from "@/lib/feed-tier-requests";
import { feedTierMeta, isFeedRegion } from "@/lib/feed-tier-catalogue";
import { getActiveLicenseForUser, getActiveLicensesForUser } from "@/lib/licenses";
import { runAction, type ActionResult } from "@/lib/action-result";
import { cancelFeedTierTrial, getFeedTierTrial } from "@/lib/feed-tier-trials";

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

    // 0086 phase 2 (docs/specs/0086-phase2-code.md section 2; coxwell notice C3): a request is
    // keyed on the licence's server row (feed_tier_request_details.server_registration_id NOT
    // NULL, 0086:414), so a licence with no registration can no longer be submitted -- the
    // library refuses with "Register a server for this licence before requesting access". That
    // replaces the former "any registration anywhere" check (R6 "binding unconfirmed" is gone:
    // there is nothing to write for an unbound licence). Ownership of the server row is
    // re-checked inside the library's transaction, never trusted from the form.
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

export type StartTrialResult =
  | { ok: true; trialId: string; endsAt: string }
  | { ok: false; error: string };

/** Trial CTA on the LD Alpha / LD Ultra tier-detail cards (marcus, horizon-portal-v2051-polish
 * trial add-on). Since 0086 phase 2 (spec section 7, Source H) a self-serve trial is an
 * access_requests envelope already approved as a trial (decided_by NULL) with its subscription
 * row and allowlist record, written through startSelfServeFeedTierTrial; the feed_tier_trials
 * row + notifications still follow, best-effort, as before. Needs the licence's registered
 * server, not just an active licence (coxwell notice C3). Returns the trial's id/endsAt (unlike
 * the generic ActionResult) so the client can render the countdown + wire the cancel button
 * without a page reload. */
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

    const trial = await startSelfServeFeedTierTrial({
      userId: session.user.id,
      licenseId: license.id,
      region,
      tierKey,
      adminUrl: "https://feed.horizonhft.com/admin/feed-tier-trials",
    });
    revalidatePath(`/feeds/${region}/tiers`);
    return { ok: true, trialId: trial.trialId ?? "", endsAt: trial.endsAt.toISOString() };
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
