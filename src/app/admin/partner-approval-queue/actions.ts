"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { logAdminAction } from "@/lib/admin";
import { runAction, type ActionResult } from "@/lib/action-result";
import { approveAndActivateDeal, declineDeal, recordDealPayment, currentCycleTag } from "@/lib/partners";

async function requireAdmin(): Promise<{ userId: string; email: string }> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) {
    throw new Error("forbidden");
  }
  return { userId: session.user.id, email: session.user.email ?? "" };
}

export async function approveDealAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction("Failed to approve deal", async () => {
    const { userId: adminUserId } = await requireAdmin();
    const dealId = formData.get("dealId") as string;
    if (!dealId) throw new Error("Missing deal");

    await approveAndActivateDeal(dealId);
    await logAdminAction(adminUserId, "admin_partner_deal_approve", null, { dealId });

    revalidatePath("/admin/partner-approval-queue");
  });
}

export async function declineDealAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction("Failed to decline deal", async () => {
    const { userId: adminUserId } = await requireAdmin();
    const dealId = formData.get("dealId") as string;
    if (!dealId) throw new Error("Missing deal");

    await declineDeal(dealId);
    await logAdminAction(adminUserId, "admin_partner_deal_decline", null, { dealId });

    revalidatePath("/admin/partner-approval-queue");
  });
}

/** Off-portal receivable record — the P1 mockup (Marcus m22759, "dumb-simple") is amount +
 * date + one-click confirm only, no channel picker or evidence upload, so channel defaults to
 * 'other' and evidence stays null (see migration 0056's comment on why those columns exist
 * anyway). Tags the payment to the current calendar-month cycle. */
export async function recordOffPortalPaymentAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to record payment", async () => {
    const { userId: adminUserId, email: adminEmail } = await requireAdmin();
    const dealId = formData.get("dealId") as string;
    const amountUsd = Number(formData.get("amountUsd"));
    if (!dealId) throw new Error("Missing deal");
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error("Amount must be a positive number");

    const paymentId = await recordDealPayment({
      dealId,
      amountUsd,
      confirmedBy: adminEmail,
      channel: "other",
      cycle: currentCycleTag(),
      notes: "Recorded off-portal via admin approval queue",
    });
    await logAdminAction(adminUserId, "admin_partner_deal_payment", null, { dealId, paymentId, amountUsd });

    revalidatePath("/admin/partner-approval-queue");
  });
}
