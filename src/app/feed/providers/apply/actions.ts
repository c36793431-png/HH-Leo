"use server";

import { createProviderApplication } from "@/lib/provider-applications";

const PROVIDERAPP_ADMIN_URL = "https://feed.horizonhft.com/admin/provider-applications";

/** Return type carries the server-generated reference_id back to the form so the confirmation
 * screen shows the same string the admin queue will show -- see 0067's migration comment for
 * why this can no longer be generated client-side. Not the shared ActionResult type (that has
 * no data channel and is used by 30 other actions that don't need one). */
export type CreateProviderApplicationResult =
  | { ok: true; referenceId: string }
  | { ok: false; error: string };

/** Public /providers/apply form on feed.horizonhft.com -- no auth required, mirrors
 * createPartnerApplicationAction's shape (trimmed required fields). Connection details
 * (protocol/host/port/compid/regions) are optional per the mockup -- Feedverse verifies the
 * endpoint before go-live, so blanks are fine here. */
export async function createProviderApplicationAction(
  _prevState: CreateProviderApplicationResult | null,
  formData: FormData
): Promise<CreateProviderApplicationResult> {
  try {
    const str = (key: string) => ((formData.get(key) as string) ?? "").trim();
    const orNull = (value: string) => value || null;

    const name = str("name");
    const email = str("email");

    if (!name) throw new Error("Tell us your company / feed provider name");
    if (!email) throw new Error("Tell us your contact email");

    const row = await createProviderApplication({
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

    return { ok: true, referenceId: row.referenceId };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.message ? err.message : "Failed to submit application" };
  }
}
