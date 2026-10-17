/**
 * Text a service provider writes goes public the moment they click Show, with no review (marcus m71369 item 1). Two
 * standing rules apply to it: NO prices anywhere on the site, and NO public contact details (clients reach a provider
 * through a request). So a public profile field is refused on save if it holds:
 *  - a money amount: a currency symbol or word next to digits ($50, 50 USD, EUR 40, 30 euros), or a rate ("/hr",
 *    "per hour", "per session", ...);
 *  - an email address, a web address (http(s)://, www., t.me/, a bare domain), an @handle;
 *  - a phone-like run of 9 or more digits (spaces, dots, dashes, brackets and a leading + allowed between them);
 *    a run of years (2015-2024) is not one.
 * ONE module: consultant-profiles.ts calls it for every public field; consult-s3-0116.test.ts pins the cases.
 * A refusal names the field and the reason, so the provider knows what to change.
 */

const CURRENCY_SYMBOL = /[$€£¥₹]\s*\d|\d\s*[$€£¥₹]/;
const CURRENCY_WORD = /\b(usd|eur|gbp|usdt|dollars?|euros?|pounds?|bucks)\b\s*\d|\d[\d.,]*\s*(k\s*)?(usd|eur|gbp|usdt|dollars?|euros?|pounds?|bucks)\b/i;
const RATE = /\/\s*(hr|hour|h|session|month|mo|call)\b|\bper\s+(hour|hr|session|month|call|day|week)\b|\bhourly\s+rate\b/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const URL = /\bhttps?:\/\/|\bwww\.|\bt\.me\/|\b[a-z0-9-]+\.(com|net|org|io|me|co|ai|app|dev|xyz|info|biz|uk|de|ru|in|gg|ly|so|to|link|site|online|store|shop|pro|tv|us|ca|au|eu)\b/i;
const HANDLE = /(^|[^\w@])@[a-z0-9_]{3,}/i;
const PHONE = /\+?\d[\d\s().-]{5,}\d/g;
/** Tech names that look like domains ("ASP.NET", "Socket.io"): not web addresses. */
const NOT_DOMAINS = /\b(asp|vb|ado|dot|socket|engine|chart|pixi|three|d3)\.(net|io|js)\b/gi;

/** null when the text is fine for a public profile; otherwise the reason, in words the provider sees. */
export function publicTextProblem(text: string): string | null {
  if (CURRENCY_SYMBOL.test(text) || CURRENCY_WORD.test(text) || RATE.test(text)) return "prices are not shown on Horizon";
  if (EMAIL.test(text)) return "contact details (an email address) are not shown on Horizon";
  if (URL.test(text.replace(NOT_DOMAINS, " "))) return "links and web addresses are not shown on Horizon";
  if (HANDLE.test(text)) return "contact details (an @handle) are not shown on Horizon";
  for (const run of text.match(PHONE) ?? []) {
    // A run of years ("2015-2024", "2019 2020 2021") is not a phone number.
    if (run.split(/[\s().-]+/).filter(Boolean).every((t) => /^(19|20)\d\d$/.test(t))) continue;
    if (run.replace(/\D/g, "").length >= 9) return "contact details (a phone number) are not shown on Horizon";
  }
  return null;
}

/** Throws `make(message)` naming the first field that fails, e.g. "About: prices are not shown on Horizon; ...". */
export function assertPublicFields(fields: [label: string, value: string | null][], make: (message: string) => Error): void {
  for (const [label, value] of fields) {
    if (!value) continue;
    const problem = publicTextProblem(value);
    if (problem) throw make(`${label}: ${problem}. Clients contact you through a request on Horizon.`);
  }
}
