"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { isAdminUser } from "@/lib/admin-users-panel";
import { logAdminAction } from "@/lib/admin";
import { runAction, type ActionResult } from "@/lib/action-result";
import { createPartner, createDeal, recordDealPayment } from "@/lib/partners";

async function requireAdminUsersPanel(): Promise<{ userId: string; email: string }> {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) {
    throw new Error("forbidden");
  }
  return { userId: session.user.id, email: session.user.email ?? "" };
}

async function resolveUserIdByEmail(email: string): Promise<string> {
  const result = await pool.query<{ id: string }>("select id from users where email = $1", [email]);
  if (!result.rows[0]) throw new Error(`No user found for email ${email}`);
  return result.rows[0].id;
}

export async function createPartnerAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to add partner", async () => {
    const { userId: adminUserId } = await requireAdminUsersPanel();
    const name = ((formData.get("name") as string) || "").trim();
    const handle = ((formData.get("handle") as string) || "").trim() || null;
    const email = ((formData.get("email") as string) || "").trim() || null;
    if (!name) throw new Error("Name is required");

    const partnerId = await createPartner({ name, handle, email });
    await logAdminAction(adminUserId, "admin_partner_create", null, { partnerId, name });

    revalidatePath("/admin/partners");
  });
}

export async function createDealAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to add deal", async () => {
    const { userId: adminUserId } = await requireAdminUsersPanel();
    const partnerId = formData.get("partnerId") as string;
    const clientEmail = ((formData.get("clientEmail") as string) || "").trim();
    const grossUsd = Number(formData.get("grossUsd"));
    const partnerPct = Number(formData.get("partnerPct")) / 100;
    if (!partnerId) throw new Error("Missing partner");
    if (!clientEmail) throw new Error("Client email is required");
    if (!Number.isFinite(grossUsd) || grossUsd <= 0) throw new Error("Gross amount must be a positive number");
    if (!Number.isFinite(partnerPct) || partnerPct <= 0 || partnerPct >= 1) {
      throw new Error("Partner % must be between 0 and 100");
    }

    const clientUserId = await resolveUserIdByEmail(clientEmail);
    const dealId = await createDeal({
      partnerId,
      clientUserId,
      grossUsd,
      partnerPct,
      coxwellPct: 1 - partnerPct,
    });
    await logAdminAction(adminUserId, "admin_partner_deal_create", clientUserId, { dealId, partnerId, grossUsd });

    revalidatePath("/admin/partners");
  });
}

export async function confirmDealPaymentAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to record deal payment", async () => {
    const { userId: adminUserId, email: adminEmail } = await requireAdminUsersPanel();
    const dealId = formData.get("dealId") as string;
    const amountUsd = Number(formData.get("amountUsd"));
    const notes = ((formData.get("notes") as string) || "").trim() || null;
    if (!dealId) throw new Error("Missing deal");
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error("Amount must be a positive number");

    const paymentId = await recordDealPayment({ dealId, amountUsd, confirmedBy: adminEmail, notes });
    await logAdminAction(adminUserId, "admin_partner_deal_payment", null, { dealId, paymentId, amountUsd });

    revalidatePath("/admin/partners");
  });
}
