"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser, isFeedProviderUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { providerApproveFeedTierRequest, providerRejectFeedTierRequest } from "@/lib/feed-providers";

async function requireProvider(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || (!isFeedProviderUser(session.user) && !isAdminUser(session.user))) {
    throw new Error("forbidden");
  }
  return session.user.id;
}

/** Approve calls the exact same approveFeedTierRequest()/insertFeedTierTrial() chain the
 * admin queue uses (spec §3, commit 00601e4, reused via providerApproveFeedTierRequest in
 * lib/feed-providers.ts) so the identical client activation email + bot ping fires. */
export async function providerApproveAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction("Failed to approve request", async () => {
    const providerId = await requireProvider();
    const id = formData.get("id") as string;
    await providerApproveFeedTierRequest(providerId, id, "/feed/dashboard/users");
    revalidatePath("/feed/dashboard/users");
    revalidatePath("/feed/dashboard");
  });
}

export async function providerRejectAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction("Failed to deny request", async () => {
    const providerId = await requireProvider();
    const id = formData.get("id") as string;
    const reason = ((formData.get("reason") as string) ?? "").trim() || null;
    await providerRejectFeedTierRequest(providerId, id, reason);
    revalidatePath("/feed/dashboard/users");
    revalidatePath("/feed/dashboard");
  });
}
