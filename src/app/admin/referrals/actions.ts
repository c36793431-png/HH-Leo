"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { logAdminAction } from "@/lib/admin";
import { runAction, type ActionResult } from "@/lib/action-result";
import { clawbackEarning, markReferrerPaid, REFERRAL_MIN_PAYOUT_USD } from "@/lib/referrals";

async function requireAdminUsersPanel(): Promise<{ userId: string; email: string }> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) {
    throw new Error("forbidden");
  }
  return { userId: session.user.id, email: session.user.email ?? "" };
}

export async function markReferrerPaidAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to record payout", async () => {
    const { userId: adminUserId, email: adminEmail } = await requireAdminUsersPanel();
    const referrerUserId = formData.get("referrerUserId") as string;
    if (!referrerUserId) throw new Error("Missing referrer");

    const total = await markReferrerPaid(referrerUserId, adminEmail);
    if (total === null) {
      throw new Error(`Referrer has less than $${REFERRAL_MIN_PAYOUT_USD} cleared — nothing to pay out.`);
    }

    await logAdminAction(adminUserId, "admin_referral_mark_paid", referrerUserId, { amountUsd: total });

    revalidatePath("/admin/referrals");
    revalidatePath("/admin/finance");
  });
}

export async function clawbackEarningAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to claw back earning", async () => {
    const { userId: adminUserId } = await requireAdminUsersPanel();
    const earningId = formData.get("earningId") as string;
    if (!earningId) throw new Error("Missing earning");

    await clawbackEarning(earningId);
    await logAdminAction(adminUserId, "admin_referral_clawback", null, { earningId });

    revalidatePath("/admin/referrals");
  });
}
