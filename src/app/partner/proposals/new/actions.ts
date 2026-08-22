"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { runAction, type ActionResult } from "@/lib/action-result";
import { getPartnerByUserId, createProposal, findUserIdByEmail } from "@/lib/partners";

async function requirePartner() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("forbidden");
  const partner = await getPartnerByUserId(session.user.id);
  if (!partner) throw new Error("forbidden");
  return partner;
}

/** P1 new-proposal form (partner-facing) — lands the deal as lifecycle 'proposed', distinct
 * from admin/partners/actions.ts's createDealAction which admin uses to enter an
 * already-agreed deal straight in as 'active'. Client must already have a Horizon account
 * (matched by email) — proposal-form.html's client-matching step assumes an existing account,
 * P1 doesn't build client-invite-by-email. */
export async function createProposalAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to submit proposal", async () => {
    const partner = await requirePartner();

    const clientEmail = ((formData.get("clientEmail") as string) || "").trim();
    const grossUsd = Number(formData.get("grossUsd"));
    const partnerPct = Number(formData.get("partnerPct")) / 100;
    const cadence = (formData.get("cadence") as string) === "one_time" ? "one_time" : "monthly";
    const tiers = formData.getAll("tiers").map((t) => String(t)).filter(Boolean);
    const note = ((formData.get("note") as string) || "").trim() || null;

    if (!clientEmail) throw new Error("Client email is required");
    if (!Number.isFinite(grossUsd) || grossUsd <= 0) throw new Error("Price must be a positive number");
    if (!Number.isFinite(partnerPct) || partnerPct <= 0 || partnerPct >= 1) {
      throw new Error("Your split must be between 0 and 100");
    }
    if (tiers.length === 0) throw new Error("Pick at least one tier for the bundle");

    const clientUserId = await findUserIdByEmail(clientEmail);
    if (!clientUserId) throw new Error(`No Horizon account found for ${clientEmail}`);

    await createProposal({
      partnerId: partner.id,
      clientUserId,
      grossUsd,
      partnerPct,
      cadence,
      tiers,
      note,
    });

    revalidatePath("/partner/dashboard");
  });
}
