/* Run: python3 /root/claudeclaw-leo/scripts/run_worktree_test.py <worktree> src/lib/release-notice-render.test.ts
 *
 * Release notice sha 2 (marcus m74741 Q5/Q6 + m74769 Q8; plan v2 m74764 s2/s4/s6; Fable C1/C3/C4/C5/N3):
 * lib/release-notice-render.ts, priceProblem() in consult-public-text.ts, sendEmail's headers + idempotencyKey.
 * Pinned here:
 *  - the TG render: & < > escaped, each https URL an <a>, the href escaped too (&amp;, C5), sentence punctuation stays
 *    outside the link; plain text with no URL is only escaped.
 *  - the APPROVED 2.2 texts (byte-exact fixtures): A = 858 code points, B = 231; both pass the price rule; they
 *    render with no & < > surprises; A has no unsubscribe anywhere, B has it on both channels.
 *  - footers: A email footer, A TG none; B email footer + URL, B TG ends with the URL as a link; B without a URL throws.
 *  - the sha: stable hex64, changes with each of the three fields, no ("a","bc") vs ("ab","c") collision.
 *  - renderProblems: a price in the subject / TG / email of EITHER audience is refused, the 4096 limit counts the
 *    rendered HTML, a clean render passes (N3: dry run, preview and send share it).
 *  - priceProblem is the three money regexes only: links pass it, publicTextProblem still refuses links and prices.
 *  - sendEmail: headers reach the Resend payload, the idempotency key reaches the Idempotency-Key request header (C1/C4,
 *    resend 6.17.2), and a call with neither is unchanged. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  A_EMAIL_FOOTER,
  TG_LIMIT,
  defaultSubject,
  noticeSha256,
  previewSubject,
  renderNotice,
  renderProblems,
  telegramHtml,
  unsubscribeHeaders,
  type NoticeTexts,
} from "./release-notice-render";
import { priceProblem, publicTextProblem } from "./consult-public-text";

const fixture = (n: string) => readFileSync(path.join(process.cwd(), "src/lib/test-fixtures", n), "utf8");
const TEXT_A = fixture("release-notice-2.2-a.txt");
const TEXT_B = fixture("release-notice-2.2-b.txt");
const URL_NOTES = "https://www.horizonhft.com/blog/horizon-v2-2-release-notes";
const UNSUB = "https://portal.horizonhft.com/unsubscribe/updates?u=11111111-2222-4333-8444-555555555555&t=" + "ab".repeat(32);
const count = (s: string) => Array.from(s).length;
const aTexts: NoticeTexts = { subject: defaultSubject("A", "2.2"), textTg: TEXT_A, textEmail: TEXT_A };
const bTexts: NoticeTexts = { subject: defaultSubject("B", "2.2"), textTg: TEXT_B, textEmail: TEXT_B };

test("telegramHtml: & < > escaped, URL -> <a>, the href escaped too, trailing punctuation stays outside", () => {
  assert.equal(telegramHtml("a & b < c > d"), "a &amp; b &lt; c &gt; d");
  assert.equal(telegramHtml("plain, no link"), "plain, no link");
  assert.equal(telegramHtml("see https://x.test/p?a=1&b=2 now"), 'see <a href="https://x.test/p?a=1&amp;b=2">https://x.test/p?a=1&amp;b=2</a> now');
  assert.equal(telegramHtml("(read https://x.test/a.) Then https://y.test/b, ok."), '(read <a href="https://x.test/a">https://x.test/a</a>.) Then <a href="https://y.test/b">https://y.test/b</a>, ok.');
  assert.equal(telegramHtml("<b>not bold</b> https://x.test"), '&lt;b&gt;not bold&lt;/b&gt; <a href="https://x.test">https://x.test</a>');
  assert.equal(telegramHtml("http://insecure.test is not linked"), "http://insecure.test is not linked");
  // a quote can't close the attribute: the URL ends at it
  assert.equal(telegramHtml('x https://x.test/a"onclick="y'), 'x <a href="https://x.test/a">https://x.test/a</a>&quot;onclick=&quot;y');
});

test("the approved 2.2 texts: lengths pinned, pass the price rule, render with the link", () => {
  assert.equal(count(TEXT_A), 858);
  assert.equal(count(TEXT_B), 231);
  assert.equal(priceProblem(TEXT_A), null);
  assert.equal(priceProblem(TEXT_B), null);
  assert.doesNotMatch(TEXT_A, /[&<>]/);
  const a = renderNotice("A", aTexts, null);
  assert.ok(a.tgHtml.includes(`<a href="${URL_NOTES}">${URL_NOTES}</a>`));
  assert.ok(a.tgHtml.startsWith("🚀 Horizon HFT 2.2 is out (fix release)"));
  assert.equal(a.tgHtml, telegramHtml(TEXT_A), "A TG has no footer");
  assert.deepEqual(renderProblems(a, "A"), []);
  const b = renderNotice("B", bTexts, UNSUB);
  assert.deepEqual(renderProblems(b, "B"), []);
});

test("A: licence footer on the email, nothing on TG, no unsubscribe anywhere", () => {
  const a = renderNotice("A", aTexts, UNSUB); // even if a URL is passed, A never shows one
  assert.equal(a.emailText, `${TEXT_A}\n\n${A_EMAIL_FOOTER}\n`);
  assert.ok(a.emailText.endsWith("You get this because you have a Horizon licence.\n"));
  for (const part of [a.tgHtml, a.emailText]) assert.doesNotMatch(part, /unsubscribe/i);
  assert.ok(!a.emailText.includes("unsubscribe/updates"));
  assert.equal(a.subject, "Horizon 2.2 is ready");
});

test("B: account footer + unsubscribe link on the email; the TG text ends with the same link, href escaped (C5)", () => {
  const b = renderNotice("B", bTexts, UNSUB);
  assert.equal(b.emailText, `${TEXT_B}\n\nYou get this because you have a Horizon account. Unsubscribe: ${UNSUB}\n`);
  const escaped = UNSUB.replace(/&/g, "&amp;");
  assert.ok(b.tgHtml.endsWith(`\n\nUnsubscribe: <a href="${escaped}">${escaped}</a>`), b.tgHtml.slice(-200));
  assert.ok(!/&t=/.test(b.tgHtml), "a bare & inside the Telegram HTML is invalid");
  assert.equal(b.subject, "Horizon 2.2 is out");
  assert.throws(() => renderNotice("B", bTexts, null), /needs an unsubscribe URL/);
});

test("unsubscribeHeaders: RFC 8058 one-click", () => {
  assert.deepEqual(unsubscribeHeaders(UNSUB), { "List-Unsubscribe": `<${UNSUB}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
});

test("previewSubject marks only the subject", () => {
  assert.equal(previewSubject("A", "Horizon 2.2 is ready"), "[preview A] Horizon 2.2 is ready");
  assert.equal(previewSubject("B", "Horizon 2.2 is out"), "[preview B] Horizon 2.2 is out");
});

test("noticeSha256: hex64, stable, changes with each field, no field-boundary collision", () => {
  const base: NoticeTexts = { subject: "s", textTg: "t", textEmail: "e" };
  const sha = noticeSha256(base);
  assert.match(sha, /^[0-9a-f]{64}$/);
  assert.equal(noticeSha256({ ...base }), sha);
  for (const k of ["subject", "textTg", "textEmail"] as const) assert.notEqual(noticeSha256({ ...base, [k]: base[k] + "x" }), sha, k);
  assert.notEqual(noticeSha256({ subject: "a", textTg: "bc", textEmail: "e" }), noticeSha256({ subject: "ab", textTg: "c", textEmail: "e" }));
  assert.notEqual(noticeSha256(aTexts), noticeSha256(bTexts));
});

test("renderProblems: a price in the subject, the TG text or the email text of either audience is refused", () => {
  const priced = "Now only $50 for Horizon";
  for (const audience of ["A", "B"] as const) {
    const base = audience === "A" ? aTexts : bTexts;
    const url = audience === "B" ? UNSUB : null;
    assert.deepEqual(renderProblems(renderNotice(audience, base, url), audience), [], `${audience} clean`);
    const inSubject = renderProblems(renderNotice(audience, { ...base, subject: priced }, url), audience);
    const inTg = renderProblems(renderNotice(audience, { ...base, textTg: base.textTg + "\n" + priced }, url), audience);
    const inEmail = renderProblems(renderNotice(audience, { ...base, textEmail: base.textEmail + "\n" + priced }, url), audience);
    assert.match(inSubject.join(), /subject has a price/);
    assert.match(inTg.join(), /Telegram text has a price/);
    assert.match(inEmail.join(), /email text has a price/);
    // a rate counts, a currency word counts
    assert.match(renderProblems(renderNotice(audience, { ...base, textEmail: "Join for 20 USD a month" }, url), audience).join(), /price/);
    assert.match(renderProblems(renderNotice(audience, { ...base, textEmail: "Billed 5/mo" }, url), audience).join(), /price/);
  }
});

test("renderProblems: the 4096 limit counts the rendered HTML (a URL appears twice in an <a>), empty parts and a long subject are refused", () => {
  const filler = (n: number) => "x".repeat(n);
  const ok = renderNotice("A", { ...aTexts, textTg: filler(TG_LIMIT) }, null);
  assert.equal(ok.tgHtml.length, TG_LIMIT);
  assert.deepEqual(renderProblems(ok, "A"), []);
  const over = renderNotice("A", { ...aTexts, textTg: filler(TG_LIMIT + 1) }, null);
  assert.match(renderProblems(over, "A").join(), /over Telegram's 4096/);
  // 2200 chars of plain URL pass a naive source-length check but render to > 4096: the URL is the label AND the href
  const urlHeavy = renderNotice("A", { ...aTexts, textTg: "https://x.test/" + filler(2200) }, null);
  assert.ok(urlHeavy.tgHtml.length > TG_LIMIT && 15 + 2200 < TG_LIMIT);
  assert.ok(urlHeavy.tgHtml.length > TG_LIMIT);
  assert.match(renderProblems(urlHeavy, "A").join(), /over Telegram's 4096/);
  // & expands to &amp; and counts as 5
  const amp = renderNotice("A", { ...aTexts, textTg: "&".repeat(900) }, null);
  assert.equal(amp.tgHtml.length, 4500);
  assert.match(renderProblems(amp, "A").join(), /over Telegram's 4096/);
  assert.match(renderProblems(renderNotice("A", { ...aTexts, textTg: "  " }, null), "A").join(), /Telegram text is empty/);
  assert.match(renderProblems(renderNotice("A", { ...aTexts, subject: " " }, null), "A").join(), /subject is empty/);
  assert.match(renderProblems(renderNotice("A", { ...aTexts, subject: "s".repeat(201) }, null), "A").join(), /subject is over 200/);
});

test("priceProblem is the three money regexes only: links pass it; publicTextProblem still refuses links, emails and prices", () => {
  assert.equal(priceProblem("Read https://www.horizonhft.com/blog/x and mail a@b.com"), null);
  assert.equal(priceProblem("$50"), "prices are not shown on Horizon");
  assert.equal(priceProblem("50 USD"), "prices are not shown on Horizon");
  assert.equal(priceProblem("20/hr"), "prices are not shown on Horizon");
  assert.equal(publicTextProblem("$50"), "prices are not shown on Horizon", "the public-text message is unchanged");
  assert.equal(publicTextProblem("see https://x.test"), "links and web addresses are not shown on Horizon");
  assert.equal(publicTextProblem("a@b.com"), "contact details (an email address) are not shown on Horizon");
  assert.equal(publicTextProblem("Plain fine text"), null);
});

// ---------- sendEmail: headers + idempotency key (C1/C4) ----------

interface Captured { url: string; headers: Headers; body: Record<string, unknown> }
async function sendWithMockedResend(options?: Parameters<typeof import("./email").sendEmail>[3]): Promise<Captured> {
  process.env.EMAIL_FROM = "Horizon HFT <noreply@example.invalid>";
  process.env.AUTH_RESEND_KEY = "re_test";
  let seen: Captured | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen = { url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? "{}")) };
    return new Response(JSON.stringify({ id: "email-1" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const { sendEmail } = await import("./email");
    const r = await sendEmail("to@example.invalid", "Subject", "Body", options);
    assert.deepEqual(r, { ok: true, emailId: "email-1" });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(seen, "Resend was called");
  return seen as Captured;
}

test("sendEmail: headers reach the Resend payload and the idempotency key becomes the Idempotency-Key header", async () => {
  const hdrs = unsubscribeHeaders(UNSUB);
  const c = await sendWithMockedResend({ headers: hdrs, idempotencyKey: "delivery-row-id-1" });
  assert.match(c.url, /api\.resend\.com\/emails$/);
  assert.deepEqual(c.body.headers, hdrs);
  assert.equal(c.headers.get("Idempotency-Key"), "delivery-row-id-1");
  assert.equal(c.body.to, "to@example.invalid");
  assert.equal(c.body.text, "Body");
});

test("sendEmail: with neither option the request is exactly as before (no headers key, no Idempotency-Key)", async () => {
  const c = await sendWithMockedResend();
  assert.equal("headers" in c.body && c.body.headers != null, false);
  assert.equal(c.headers.get("Idempotency-Key"), null);
  const r = await sendWithMockedResend({ replyTo: "reply@example.invalid" });
  assert.equal(r.body.reply_to, "reply@example.invalid");
  assert.equal(r.headers.get("Idempotency-Key"), null);
});
