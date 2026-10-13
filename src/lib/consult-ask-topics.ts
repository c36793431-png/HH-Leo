/**
 * The Ask form's topics (marcus Q1 m66313). consult_requests.topic holds one of these keys: the
 * server writes nothing else, and 0105's CHECK (consult_requests_topic_check) only caps the length,
 * so adding a topic here needs no migration. The keys are www's package names on /consulting: its
 * "Request a quote" (Custom), "Register interest" (Guided) and "Talk to us" (Always-on) land on
 * /marketplace/consulting/ask with the topic prefilled (m66302); 'general' is the Ask form opened
 * with no prefill. A topic is not a consult_services row and makes none.
 *
 * Keys are slug-shaped (isConsultSlug) and at most CONSULT_ASK_TOPIC_MAX long; consult-0105.test.ts
 * pins both, because S5 builds one exact login-callback entry per key from this constant (Q2).
 */
export const CONSULT_ASK_TOPICS = {
  general: "General question",
  custom: "Custom",
  guided: "Guided",
  "always-on": "Always-on",
} as const;

export type ConsultAskTopic = keyof typeof CONSULT_ASK_TOPICS;

export const CONSULT_ASK_TOPIC_MAX = 32;

export function isConsultAskTopic(topic: string): topic is ConsultAskTopic {
  return Object.prototype.hasOwnProperty.call(CONSULT_ASK_TOPICS, topic);
}
