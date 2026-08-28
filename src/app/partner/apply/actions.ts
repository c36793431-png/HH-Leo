"use server";

import { createPartnerApplication } from "@/lib/partner-applications";
import { runAction, type ActionResult } from "@/lib/action-result";

// Host is load-bearing: partner-applications review lives on portal-admin today -- revisit if it moves surfaces.
const PARTNERAPP_ADMIN_URL = "https://portal.horizonhft.com/admin/partner-applications";

/** Public /apply form on partner.horizonhft.com -- no auth required, mirrors
 * submitFeedRequestAction's shape (runAction wrapper, trimmed required fields). */
export async function createPartnerApplicationAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to submit application", async () => {
    const name = ((formData.get("name") as string) ?? "").trim();
    const email = ((formData.get("email") as string) ?? "").trim();
    const telegram = ((formData.get("telegram") as string) ?? "").trim() || null;
    const notes = ((formData.get("notes") as string) ?? "").trim() || null;

    if (!name) throw new Error("Tell us your name");
    if (!email) throw new Error("Tell us your email");

    await createPartnerApplication({ name, email, telegram, notes, adminUrl: PARTNERAPP_ADMIN_URL });
  });
}
