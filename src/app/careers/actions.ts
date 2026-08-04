"use server";

import { createApplication, deleteCvBlob, ROLE_INTERESTS, type RoleInterest } from "@/lib/applications";
import { sendEmail } from "@/lib/email";
import { runAction, type ActionResult } from "@/lib/action-result";

const ADMIN_NOTIFY_EMAIL = "hfthorizon@keemail.me";

export async function submitApplicationAction(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runAction("Failed to submit application", async () => {
    // Honeypot — real visitors never see or fill this field.
    const honeypot = (formData.get("website") as string) ?? "";
    if (honeypot.trim() !== "") {
      // Pretend success to the bot, do nothing.
      return;
    }

    const name = ((formData.get("name") as string) ?? "").trim();
    const email = ((formData.get("email") as string) ?? "").trim().toLowerCase();
    const roleInterest = (formData.get("roleInterest") as string) ?? "";
    const message = ((formData.get("message") as string) ?? "").trim() || null;
    const cvBlobPathname = ((formData.get("cvBlobPathname") as string) ?? "").trim() || null;

    if (!name) throw new Error("Name is required");
    if (!email || !email.includes("@")) throw new Error("A valid email is required");
    if (!ROLE_INTERESTS.includes(roleInterest as RoleInterest)) throw new Error("Invalid role interest");

    let application;
    try {
      application = await createApplication({ name, email, roleInterest, message, cvBlobPathname });
    } catch (err) {
      if (cvBlobPathname) await deleteCvBlob(cvBlobPathname);
      throw err;
    }

    await sendEmail(
      email,
      "Application received — Horizon HFT",
      `Hi ${name},\n\nWe received your application for ${roleInterest}. We'll be in touch via email.\n\n— Horizon HFT`
    ).catch(() => {});

    await sendEmail(
      ADMIN_NOTIFY_EMAIL,
      `New application: ${name} (${roleInterest})`,
      `${name} <${email}> applied for ${roleInterest}.\n\nReview at /admin/applications — application ID ${application.id}.`
    ).catch(() => {});
  });
}
