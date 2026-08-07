"use server";

import { auth } from "@/lib/auth";
import { createStrategyRequest } from "@/lib/strategy-requests";
import { runAction, type ActionResult } from "@/lib/action-result";

export async function submitStrategyRequestAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to submit request", async () => {
    const session = await auth();
    if (!session?.user?.id) throw new Error("You must be signed in to request a strategy");

    const ideaText = ((formData.get("ideaText") as string) ?? "").trim();
    const assetText = ((formData.get("assetText") as string) ?? "").trim() || null;
    const timeframeText = ((formData.get("timeframeText") as string) ?? "").trim() || null;
    const referencesText = ((formData.get("referencesText") as string) ?? "").trim() || null;

    if (!ideaText) throw new Error("Tell us what kind of strategy you need");

    await createStrategyRequest({
      userId: session.user.id,
      ideaText,
      assetText,
      timeframeText,
      referencesText,
    });
  });
}
