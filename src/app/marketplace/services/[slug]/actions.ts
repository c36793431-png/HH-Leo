"use server";

import { auth } from "@/lib/auth";
import { runAction, type ActionResult } from "@/lib/action-result";
import { createProviderRequest, parseProviderRequest } from "@/lib/consult-provider-requests";

/** A signed-in client's request to one listed provider (consult S4). The slug comes from the form; the lib re-checks
 * the listing gate and refuses the client's own profile, so a crafted slug can only reach a provider who is listed. */
export async function sendProviderRequestAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction("Failed to send your request", async () => {
    const session = await auth();
    if (!session?.user?.id) throw new Error("Sign in to send a request");
    const slug = typeof formData.get("slug") === "string" ? String(formData.get("slug")) : "";
    await createProviderRequest(session.user.id, slug, parseProviderRequest(formData));
  });
}
