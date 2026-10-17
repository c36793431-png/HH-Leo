"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { runAction, type ActionResult } from "@/lib/action-result";
import { parseConsultantProfile, saveOwnConsultantProfile, setOwnConsultantProfilePublished } from "@/lib/consultant-profiles";

/** The provider's own profile (S3). Every write is for the signed-in account only: the lib re-checks that its
 * application is approved and linked to it (consultant-profiles.ts), so these actions take no id from the form. */
async function signedInUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Sign in again to save");
  return session.user.id;
}

export async function saveConsultantProfileAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction("Failed to save your profile", async () => {
    await saveOwnConsultantProfile(await signedInUserId(), parseConsultantProfile(formData));
    revalidatePath("/consult/dashboard");
  });
}

export async function setConsultantProfilePublishedAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction("Failed to change your profile", async () => {
    await setOwnConsultantProfilePublished(await signedInUserId(), formData.get("published") === "true");
    revalidatePath("/consult/dashboard");
  });
}
