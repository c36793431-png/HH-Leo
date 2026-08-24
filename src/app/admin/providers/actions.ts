"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { confirmProposalRound } from "@/lib/provider-tier-proposals";

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
    await confirmProposalRound(proposalId, adminId);
    revalidatePath("/admin/providers");
  });
}
