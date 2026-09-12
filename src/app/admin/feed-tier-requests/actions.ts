"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { approveFeedTierRequest, rejectFeedTierRequest } from "@/lib/feed-tier-requests";

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) throw new Error("forbidden");
  return session.user.id;
}

/** 0086 phase 2 (docs/specs/0086-phase2-code.md sections 3 and 4(d)): the admin decides trial
 * vs paid per line (Source K). paid carries the end date the invoice bought and the invoice
 * ref; trial carries neither -- its end is derived server-side as now() + 7 days (S4), so any
 * submitted date is ignored. The library re-validates; this only shapes the form input. */
export async function approveFeedTierRequestAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to approve request", async () => {
    const adminId = await requireAdmin();
    const id = formData.get("id") as string;
    const decision = (formData.get("decision") as string) ?? "";
    if (decision !== "trial" && decision !== "paid") throw new Error("Choose trial or paid");
    const endsAtRaw = ((formData.get("endsAt") as string) ?? "").trim();
    const invoiceRef = ((formData.get("invoiceRef") as string) ?? "").trim() || null;
    const endsAt = decision === "paid" ? (endsAtRaw ? new Date(endsAtRaw) : null) : null;
    if (decision === "paid" && (!endsAt || Number.isNaN(endsAt.getTime()))) throw new Error("Paid approval needs an end date");
    await approveFeedTierRequest(id, adminId, "https://feed.horizonhft.com/admin/feed-tier-trials", {
      decision,
      endsAt,
      invoiceRef: decision === "paid" ? invoiceRef : null,
    });
    revalidatePath("/admin/feed-tier-requests");
  });
}

export async function rejectFeedTierRequestAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to reject request", async () => {
    const adminId = await requireAdmin();
    const id = formData.get("id") as string;
    const reason = ((formData.get("reason") as string) ?? "").trim() || null;
    await rejectFeedTierRequest(id, adminId, reason);
    revalidatePath("/admin/feed-tier-requests");
  });
}
