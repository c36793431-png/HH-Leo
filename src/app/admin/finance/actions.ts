"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { insertPayment, PAYMENT_SOURCE_TYPES, type PaymentSourceType } from "@/lib/payments";
import { logAdminAction } from "@/lib/admin";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";

async function requireAdminUsersPanel(): Promise<{ userId: string; email: string }> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUsersPanelEmail(session.user.email)) {
    throw new Error("forbidden");
  }
  return { userId: session.user.id, email: session.user.email ?? "" };
}

async function resolveUserIdByEmail(email: string | null): Promise<string | null> {
  if (!email) return null;
  const result = await pool.query<{ id: string }>("select id from users where email = $1", [email]);
  return result.rows[0]?.id ?? null;
}

export async function addPaymentAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to record payment", async () => {
    const { userId: adminUserId, email: adminEmail } = await requireAdminUsersPanel();

    const receivedAtRaw = formData.get("receivedAt") as string;
    const amountRaw = formData.get("amountUsd") as string;
    const currency = ((formData.get("currency") as string) || "USD").trim().toUpperCase();
    const sourceType = formData.get("sourceType") as string;
    const counterparty = ((formData.get("counterparty") as string) || "").trim() || null;
    const memo = ((formData.get("memo") as string) || "").trim() || null;

    if (!PAYMENT_SOURCE_TYPES.includes(sourceType as PaymentSourceType)) {
      throw new Error("Invalid source type");
    }
    const amountUsd = Number(amountRaw);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new Error("Amount must be a positive number");
    }
    const receivedAt = receivedAtRaw ? new Date(receivedAtRaw) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      throw new Error("Invalid date");
    }

    const userId = sourceType === "customer" ? await resolveUserIdByEmail(counterparty) : null;

    const paymentId = await insertPayment({
      receivedAt,
      amountUsd,
      currency,
      sourceType: sourceType as PaymentSourceType,
      counterparty,
      userId,
      memo,
      createdBy: adminEmail,
    });

    await logAdminAction(adminUserId, "admin_finance_add_payment", userId, { paymentId, amountUsd, sourceType });

    revalidatePath("/admin/finance");
    revalidatePath("/admin/dashboard");
  });
}
