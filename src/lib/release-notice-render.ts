/** Release notice renders (marcus m74741 Q5/Q6, m74769 Q8; plan v2 m74764 section 2; Fable C3/C5/N3). PURE: no db, no send.
 *
 * Source = PLAIN text per audience (no HTML). Each audience has a subject, a text_tg and a text_email; the run stores
 * those and the sha256 over them, and a real send needs both audiences' shas unchanged since coxwell's tap.
 *  - Telegram render: escape & < >, wrap each https URL in <a href> (C5: the href carries &amp; like the text does).
 *  - Email render: the plain text verbatim + the audience footer.
 *  - The footer is NOT part of the sha: it is code, and B's carries a per-user unsubscribe link. What is sent is the
 *    sha'd text plus a footer this file builds, and renderProblems() runs the guards on that FINAL render.
 *  - A (clients): email footer "You get this because you have a Horizon licence."; the TG text has no footer; no unsubscribe
 *    anywhere (a service notice).
 *  - B (others): email footer "You get this because you have a Horizon account. Unsubscribe: <url>", and the TG text ends
 *    with "Unsubscribe: <url>" (Q8: the opt-out gates both B channels). RFC 8058 headers for the email.
 * The unsubscribe URL itself is built by the route's lib (a later sha); here it is a parameter. */
import { createHash } from "node:crypto";
import { priceProblem } from "./consult-public-text";
import type { Audience } from "./release-notices";

export const TG_LIMIT = 4096;
export const SUBJECT_MAX = 200; // release_notice_runs.{a,b}_subject CHECK (0117)

export interface NoticeTexts {
  subject: string;
  textTg: string;
  textEmail: string;
}

export interface Rendered {
  subject: string;
  /** Telegram parse_mode HTML. */
  tgHtml: string;
  /** Plain text email body. */
  emailText: string;
}

export const A_EMAIL_FOOTER = "You get this because you have a Horizon licence.";
export const B_EMAIL_FOOTER_LEAD = "You get this because you have a Horizon account. Unsubscribe: ";
export const B_TG_FOOTER_LEAD = "Unsubscribe: ";

/** The default subjects (plan v2 section 2). */
export function defaultSubject(audience: Audience, version: string): string {
  return audience === "A" ? `Horizon ${version} is ready` : `Horizon ${version} is out`;
}

/** The preview to the acting admin: same render, only the subject carries the marker (plan v2 section 6). */
export function previewSubject(audience: Audience, subject: string): string {
  return `[preview ${audience}] ${subject}`;
}

/** sha256 over (subject, text_tg, text_email). A JSON array, so ("a","bc") and ("ab","c") cannot collide. */
export function noticeSha256(t: NoticeTexts): string {
  return createHash("sha256").update(JSON.stringify([t.subject, t.textTg, t.textEmail]), "utf8").digest("hex");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const URL_RE = /https:\/\/[^\s<>"]+/g;
/** A sentence's closing punctuation belongs to the sentence, not the link. */
const TRAILING = /[.,;:!?)\]]+$/;

/** Plain text -> Telegram HTML: everything escaped, each https URL an <a> whose href is escaped too (C5: "&" -> "&amp;"). */
export function telegramHtml(plain: string): string {
  let out = "";
  let last = 0;
  for (const m of plain.matchAll(URL_RE)) {
    const url = m[0].replace(TRAILING, "");
    const at = m.index ?? 0;
    out += escapeHtml(plain.slice(last, at)) + `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
    last = at + url.length;
  }
  return out + escapeHtml(plain.slice(last));
}

/** RFC 8058 one-click headers for a B email: Gmail/Apple POST straight to the unsubscribe endpoint. */
export function unsubscribeHeaders(url: string): Record<string, string> {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

/** The final render for ONE recipient. B needs its unsubscribe URL; A never takes one. */
export function renderNotice(audience: Audience, t: NoticeTexts, unsubscribeUrl: string | null): Rendered {
  if (audience === "B") {
    if (!unsubscribeUrl) throw new Error("renderNotice: audience B needs an unsubscribe URL");
    return {
      subject: t.subject,
      tgHtml: telegramHtml(`${t.textTg}\n\n${B_TG_FOOTER_LEAD}${unsubscribeUrl}`),
      emailText: `${t.textEmail}\n\n${B_EMAIL_FOOTER_LEAD}${unsubscribeUrl}\n`,
    };
  }
  return {
    subject: t.subject,
    tgHtml: telegramHtml(t.textTg),
    emailText: `${t.textEmail}\n\n${A_EMAIL_FOOTER}\n`,
  };
}

/** Why this render may not be sent; empty = fine. The price rule runs on all three parts of the render, and Telegram's
 * 4096 limit on the rendered HTML (stricter than Telegram's own count, which ignores tags). The dry run, the preview
 * and the send all use this one function (Fable N3). */
export function renderProblems(r: Rendered, label: string): string[] {
  const out: string[] = [];
  if (r.subject.trim().length === 0) out.push(`${label}: the subject is empty`);
  if (r.subject.length > SUBJECT_MAX) out.push(`${label}: the subject is over ${SUBJECT_MAX} characters`);
  if (r.tgHtml.trim().length === 0) out.push(`${label}: the Telegram text is empty`);
  if (r.emailText.trim().length === 0) out.push(`${label}: the email text is empty`);
  if (r.tgHtml.length > TG_LIMIT) out.push(`${label}: the Telegram text is ${r.tgHtml.length} characters, over Telegram's ${TG_LIMIT}`);
  for (const [part, text] of [["subject", r.subject], ["Telegram text", r.tgHtml], ["email text", r.emailText]] as const) {
    const p = priceProblem(text);
    if (p) out.push(`${label}: the ${part} has a price (${p})`);
  }
  return out;
}
