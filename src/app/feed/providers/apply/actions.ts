"use server";

import { createProviderApplication } from "@/lib/provider-applications";
import { runAction, type ActionResult } from "@/lib/action-result";

const PROVIDERAPP_ADMIN_URL = "https://portal.horizonhft.com/admin/provider-applications";

/** Public /providers/apply form on feed.horizonhft.com -- no auth required, mirrors
 * createPartnerApplicationAction's shape (runAction wrapper, trimmed required fields).
 * Connection details (protocol/host/port/compid/regions) are optional per the mockup --
 * Feedverse verifies the endpoint before go-live, so blanks are fine here. */
export async function createProviderApplicationAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to submit application", async () => {
    const str = (key: string) => ((formData.get(key) as string) ?? "").trim();
    const orNull = (value: string) => value || null;

    const name = str("name");
    const email = str("email");

    if (!name) throw new Error("Tell us your company / feed provider name");
    if (!email) throw new Error("Tell us your contact email");

    await createProviderApplication({
      name,
      email,
      contactName: orNull(str("contactName")),
      country: orNull(str("country")),
      timezone: orNull(str("timezone")),
      websiteUrl: orNull(str("websiteUrl")),
      protocol: orNull(str("protocol")),
      host: orNull(str("host")),
      port: orNull(str("port")),
      compid: orNull(str("compid")),
      regions: orNull(str("regions")),
      coverage: orNull(str("coverage")),
      tiersOffered: orNull(str("tiersOffered")),
      notes: orNull(str("notes")),
      adminUrl: PROVIDERAPP_ADMIN_URL,
    });
  });
}
