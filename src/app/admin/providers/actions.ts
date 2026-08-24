"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { confirmProposalRound, declineProposalRound } from "@/lib/provider-tier-proposals";

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
  return session.user.id;
}

export async function confirmProposalAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to confirm proposal", async () => {
    const adminId = await requireAdmin();
    const proposalId = formData.get("proposalId") as string;
    const overrideRaw = (formData.get("providerSplitPctOverride") as string) ?? "";
    const override = overrideRaw.trim() === "" ? undefined : Number(overrideRaw);
    if (override !== undefined && (!Number.isInteger(override) || override < 0 || override > 100)) {
      throw new Error("Provider share override must be a whole number between 0 and 100");
    }
    await confirmProposalRound(proposalId, adminId, override);
    revalidatePath("/admin/providers");
  });
}

export async function declineProposalAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to decline proposal", async () => {
    const adminId = await requireAdmin();
    const proposalId = formData.get("proposalId") as string;
    const declinedNote = ((formData.get("declinedNote") as string) ?? "").trim();
    if (!declinedNote) throw new Error("A private note is required to decline");
    await declineProposalRound(proposalId, adminId, declinedNote);
    revalidatePath("/admin/providers");
  });
}
