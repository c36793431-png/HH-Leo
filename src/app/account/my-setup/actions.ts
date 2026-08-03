"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { runAction, type ActionResult } from "@/lib/action-result";
import {
  saveConfigSummary,
  deleteConfigSummary,
  parseConfigParamsText,
  CONFIG_SUMMARY_STRATEGIES,
  type ConfigSummaryStrategy,
} from "@/lib/config-summary";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return session.user.id;
}

export async function saveMyConfigSummaryAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to save config summary", async () => {
    const userId = await requireUserId();
    const strategy = (formData.get("strategy") as string) || null;
    if (strategy && !CONFIG_SUMMARY_STRATEGIES.includes(strategy as ConfigSummaryStrategy)) {
      throw new Error("Invalid strategy");
    }
    const commissionRaw = (formData.get("commissionPtsRoundTrip") as string) ?? "";
    const symbolsRaw = (formData.get("symbols") as string) ?? "";

    await saveConfigSummary(
      userId,
      {
        broker: ((formData.get("broker") as string) ?? "").trim() || null,
        accountType: ((formData.get("accountType") as string) ?? "").trim() || null,
        commissionPtsRoundTrip: commissionRaw.trim() === "" ? null : Math.round(Number(commissionRaw)),
        fastFeedProvider: ((formData.get("fastFeedProvider") as string) ?? "").trim() || null,
        symbols: symbolsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        strategy: strategy as ConfigSummaryStrategy | null,
        configJson: parseConfigParamsText((formData.get("configParams") as string) ?? ""),
        notes: ((formData.get("notes") as string) ?? "").trim() || null,
      },
      "self_reported",
      userId
    );
    revalidatePath("/account/my-setup");
  });
}

export async function deleteMyConfigSummaryAction(
  _prevState: ActionResult | null,
  _formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to clear config summary", async () => {
    const userId = await requireUserId();
    await deleteConfigSummary(userId);
    revalidatePath("/account/my-setup");
  });
}
