"use server";

import { runAction, type ActionResult } from "@/lib/action-result";
import { submitConsultantApplicationForm } from "@/lib/consultant-applications";

/** Public, no sign-in (0055 partner pattern). The honeypot, the limits and the one-open-per-email refusal all live
 * in submitConsultantApplicationForm. No receipt email (Fable m69076 ask 2): the confirmation is on screen. */
export async function submitConsultantApplicationAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to submit application", () => submitConsultantApplicationForm(formData));
}
