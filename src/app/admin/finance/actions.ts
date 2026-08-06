"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import {
  insertPayment,
  updatePayment,
  deletePayment,
  PAYMENT_CATEGORIES,
  PAYMENT_DIRECTIONS,
  type PaymentCategory,
  type PaymentDirection,
} from "@/lib/payments";
import { logAdminAction } from "@/lib/admin";
import { isAdminUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { maybeCreateReferralEarning } from "@/lib/referrals";

async function requireAdminUsersPanel(): Promise<{ userId: string; email: string }> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) {
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
    const direction = formData.get("direction") as string;
    const category = formData.get("category") as string;
    const counterparty = ((formData.get("counterparty") as string) || "").trim() || null;
    const memo = ((formData.get("memo") as string) || "").trim() || null;

    if (!PAYMENT_DIRECTIONS.includes(direction as PaymentDirection)) {
      throw new Error("Invalid direction");
    }
    if (!PAYMENT_CATEGORIES.includes(category as PaymentCategory)) {
      throw new Error("Invalid category");
    }
    const amountUsd = Number(amountRaw);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new Error("Amount must be a positive number");
    }
    const receivedAt = receivedAtRaw ? new Date(receivedAtRaw) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      throw new Error("Invalid date");
    }

    const userId = category === "customer" ? await resolveUserIdByEmail(counterparty) : null;

    const paymentId = await insertPayment({
      receivedAt,
      amountUsd,
      currency,
      direction: direction as PaymentDirection,
      category: category as PaymentCategory,
      counterparty,
      userId,
      memo,
      createdBy: adminEmail,
    });

    await logAdminAction(adminUserId, "admin_finance_add_payment", userId, {
      paymentId,
      amountUsd,
      direction,
      category,
    });

    if (direction === "in" && category === "customer") {
      await maybeCreateReferralEarning(paymentId);
    }

    revalidatePath("/admin/finance");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/referrals");
  });
}

export async function editPaymentAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to update payment", async () => {
    const { userId: adminUserId } = await requireAdminUsersPanel();

    const paymentId = formData.get("paymentId") as string;
    const amountRaw = formData.get("amountUsd") as string;
    const currency = ((formData.get("currency") as string) || "USD").trim().toUpperCase();
    const direction = formData.get("direction") as string;
    const category = formData.get("category") as string;
    const counterparty = ((formData.get("counterparty") as string) || "").trim() || null;
    const memo = ((formData.get("memo") as string) || "").trim() || null;

    if (!paymentId) throw new Error("Missing payment ID");
    if (!PAYMENT_DIRECTIONS.includes(direction as PaymentDirection)) {
      throw new Error("Invalid direction");
    }
    if (!PAYMENT_CATEGORIES.includes(category as PaymentCategory)) {
      throw new Error("Invalid category");
    }
    const amountUsd = Number(amountRaw);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new Error("Amount must be a positive number");
    }

    await updatePayment(paymentId, {
      amountUsd,
      currency,
      direction: direction as PaymentDirection,
      category: category as PaymentCategory,
      counterparty,
      memo,
    });

    await logAdminAction(adminUserId, "admin_finance_edit_payment", null, {
      paymentId,
      amountUsd,
      direction,
      category,
    });

    revalidatePath("/admin/finance");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/referrals");
  });
}

export async function deletePaymentAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to delete payment", async () => {
    const { userId: adminUserId } = await requireAdminUsersPanel();

    const paymentId = formData.get("paymentId") as string;
    if (!paymentId) throw new Error("Missing payment ID");

    await deletePayment(paymentId);

    await logAdminAction(adminUserId, "admin_finance_delete_payment", null, { paymentId });

    revalidatePath("/admin/finance");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/referrals");
  });
}
