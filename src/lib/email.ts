import { Resend } from "resend";

let client: Resend | null = null;

function resendClient(): Resend {
  if (!client) client = new Resend(process.env.AUTH_RESEND_KEY);
  return client;
}

/** Best-effort transactional email — used as the notification fallback for users with no linked Telegram ID. */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  options?: { replyTo?: string }
): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    console.error("sendEmail: EMAIL_FROM not configured");
    return;
  }
  try {
    await resendClient().emails.send({
      from,
      to,
      subject,
      text,
      ...(options?.replyTo ? { replyTo: options.replyTo } : {}),
    });
  } catch (err) {
    console.error("sendEmail failed", err);
  }
}
