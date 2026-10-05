import { Resend } from "resend";

let client: Resend | null = null;

function resendClient(): Resend {
  if (!client) client = new Resend(process.env.AUTH_RESEND_KEY);
  return client;
}

export type EmailSendResult = { ok: true; emailId: string | null } | { ok: false; error: string };

/** Best-effort transactional email — used as the notification fallback for users with no linked Telegram ID.
 * Never throws. Returns Resend's email id, or why it was not sent, so a caller can record it. */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  options?: { replyTo?: string }
): Promise<EmailSendResult> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    console.error("sendEmail: EMAIL_FROM not configured");
    return { ok: false, error: "EMAIL_FROM not configured" };
  }
  try {
    // Resend returns { error } on a non-2xx or a network failure; it does not throw. The error
    // carries Resend's name and message only, never the body, so the line holds no key.
    const { data, error } = await resendClient().emails.send({
      from,
      to,
      subject,
      text,
      ...(options?.replyTo ? { replyTo: options.replyTo } : {}),
    });
    if (error) {
      console.error("sendEmail failed", error.name, error.message);
      return { ok: false, error: `${error.name} ${error.message}`.slice(0, 500) };
    }
    return { ok: true, emailId: data?.id ?? null };
  } catch (err) {
    console.error("sendEmail failed", err);
    return { ok: false, error: String(err).slice(0, 500) };
  }
}
