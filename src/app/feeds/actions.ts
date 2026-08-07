"use server";

import { auth } from "@/lib/auth";
import { createFeedRequest } from "@/lib/feed-requests";
import { runAction, type ActionResult } from "@/lib/action-result";

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
