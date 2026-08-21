"use server";

import { auth } from "@/lib/auth";
import {
  createStrategyRequest,
  createStructuredStrategyRequest,
  STRATEGY_CATEGORIES,
  STRATEGY_CONTACT_PREFERENCES,
  STRATEGY_FEED_REQUIREMENTS,
  type StrategyCategory,
  type StrategyContactPreference,
  type StrategyFeedRequirement,
} from "@/lib/strategy-requests";
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

export async function submitStrategyBuildAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to submit strategy", async () => {
    const session = await auth();
    if (!session?.user?.id) throw new Error("You must be signed in to submit a strategy");

    const strategyName = ((formData.get("strategyName") as string) ?? "").trim();
    const categoryRaw = ((formData.get("category") as string) ?? "").trim();
    const description = ((formData.get("description") as string) ?? "").trim();
    const feedRequirementRaw = ((formData.get("feedRequirement") as string) ?? "").trim();
    const contactPreferenceRaw = ((formData.get("contactPreference") as string) ?? "").trim();
    const instruments = formData.getAll("instruments").map((v) => String(v).trim()).filter(Boolean);

    if (!strategyName) throw new Error("Give your strategy a name");
    if (!STRATEGY_CATEGORIES.includes(categoryRaw as StrategyCategory)) throw new Error("Pick a category");
    if (!description) throw new Error("Describe your strategy");
    if (!STRATEGY_CONTACT_PREFERENCES.includes(contactPreferenceRaw as StrategyContactPreference)) {
      throw new Error("Pick a contact preference");
    }
    const feedRequirement = STRATEGY_FEED_REQUIREMENTS.includes(feedRequirementRaw as StrategyFeedRequirement)
      ? (feedRequirementRaw as StrategyFeedRequirement)
      : null;

    await createStructuredStrategyRequest({
      userId: session.user.id,
      strategyName,
      category: categoryRaw as StrategyCategory,
      instruments,
      feedRequirement,
      description,
      contactPreference: contactPreferenceRaw as StrategyContactPreference,
    });
  });
}
