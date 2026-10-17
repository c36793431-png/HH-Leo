/* Run: npx tsx --test src/lib/consultant-applications-0112.test.ts
 *
 * Consult S1a: migration 0112 (consultant_applications) and lib/consultant-applications.ts (marcus m68993, rulings
 * m69004, answers m69029; scope kai m69020 item 9; Fable PASS WITH STRIKES m69076, tests S5). Pinned here:
 *  - the 0112 CHECKs: lengths, lower(trim()) email with an '@' after the first character, http(s) profile_url,
 *    a decided row has its time, a decline has its note (Fable S1, S2);
 *  - one open application per email across pending AND approved; a declined applicant may apply again; the race;
 *  - the form path: a filled honeypot returns success and writes and sends nothing; a mixed-case email is stored
 *    lowercase; 'javascript:' is refused; one text-only card, capped, with no background or profile link (S4);
 *  - approve/decline: one transaction with a pending guard (a second decision throws and writes no second audit
 *    row), the admin_actions rows, a decline needs a note, user_id linked at approve only by the stored email
 *    (none -> NULL, more than one -> refused), mail after commit, the decline mail never carries the note (S3);
 *  - the rollback refuses while any row exists.
 * Real Postgres, no prod: the PGlite harness of basket-requests.test.ts (the REAL migration chain, the shipped lib
 * through db.ts's global._pgPool seam, fetch stubbed for Telegram and Resend). */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const SEED_PROVIDER = "00000000-0000-4000-8000-0000000000a1";
const ADMIN = "00000000-0000-4000-8000-00000000c012";
const SEVEN_PAIRS = [
  ["9239faa5-88a0-4789-9774-b0c161823b29", "c0e8b76c-3b3d-433d-a47c-b7ba4f87c45b"],
  ["a66d928c-6830-4cb3-80af-06cfca4ad3b6", "6c3f0587-b3b3-4a58-909f-05c507d975e9"],
  ["5182a8be-96ab-4ad7-8b3c-ff2603e8f784", "973abad0-bc81-4c8e-87cf-9a30c1287385"],
  ["a830b5f8-a358-4203-971d-281fd65784b9", "176ca960-de6a-4dac-b17b-693448a526ad"],
  ["122221aa-789d-4830-8726-2060147d9206", "5b50698e-98f1-4ca3-b607-e91ae2183028"],
  ["ce3d2cce-28dc-4e4c-bb8e-889c9a6a29db", "692523d5-207d-4ad5-8310-2702035d29c2"],
  ["5e3fa8fd-ebac-4516-a68a-9d8101644786", "6865647f-735f-4db6-b3da-5f233e341aa0"],
];
const SEEDS: Record<string, string> = {
  "0046_partner_backfill_legitcashmaker_aylrn.sql": `insert into users (email) values ('giang2000ln@gmail.com');`,
  "0081_feed_subscriptions_license_id.sql": `
    insert into users (id, email, role) values ('${SEED_PROVIDER}', 'seed-provider@example.invalid', 'feed_provider');
    update feed_tiers set provider_user_id = '${SEED_PROVIDER}';
    update feed_tiers set id = '21842a66-62be-46e6-a0b1-c38ff78a0da5' where tier_key = 'ld-beta-56';
    update feed_tiers set id = '19cb2c39-8446-4b91-937f-16da2250770d' where tier_key = 'ld-gamma-19';
    update feed_tiers set id = 'a8538ab6-0057-44a8-80c2-6877980c85e6' where tier_key = 'ld-delta-18';
    ${SEVEN_PAIRS.map(([u, l], i) => `
      insert into users (id, email) values ('${u}', 'seed${i}@example.invalid');
      insert into licenses (id, user_id, license_key, expires_at, feed_types)
        values ('${l}', '${u}', 'SEED-${i}', now() + interval '90 days', array['london']);`).join("")}`,
};
const SKIPPED = new Set(["0082_provider_client_pseudonyms_backfill.sql"]);

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let ca: typeof import("./consultant-applications");
let runAction: typeof import("./action-result").runAction;
const telegramSends: { chatId: string; threadId: unknown; text: string; hasButtons: boolean }[] = [];
const emails: { to: string; subject: string; text: string }[] = [];
let resendDown = false;

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}

/** The statement fails with this SQLSTATE, naming this constraint or index. */
async function refused(p: Promise<unknown>, code: string, name: string) {
  await assert.rejects(p, (e: any) => {
    assert.equal(e.code, code, `expected ${code} (${name}), got ${e.code}: ${e.message}`);
    assert.match(String(e.message), new RegExp(name));
    return true;
  });
}

before(async () => {
  db = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort();
  for (const f of files) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await db.exec(SEEDS[f]);
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  (globalThis as any)._pgPool = {
    query: sql,
    connect: async () => ({ query: sql, release() {} }),
  };
  process.env.TELEMETRY_BOT_TOKEN = "test-token";
  process.env.EMAIL_FROM = "Horizon HFT <noreply@example.invalid>";
  process.env.AUTH_RESEND_KEY = "re_test";
  (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (u.includes("api.resend.com")) {
      if (resendDown) throw new Error("resend down");
      const body = JSON.parse(String(init?.body ?? "{}"));
      emails.push({ to: [body.to].flat().join(","), subject: String(body.subject), text: String(body.text) });
      return new Response(JSON.stringify({ id: "email-1" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/sendMessage") && init?.body) {
      const body = JSON.parse(init.body);
      telegramSends.push({ chatId: String(body.chat_id), threadId: body.message_thread_id, text: String(body.text), hasButtons: body.reply_markup != null });
    }
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  };
  ca = await import("./consultant-applications");
  runAction = (await import("./action-result")).runAction;
  await sql(`insert into users (id, email, role) values ($1, 'admin@example.invalid', 'admin')`, [ADMIN]);
});

let seq = 0;
/** A consultant_applications row with every required column filled; `cols` overrides. */
function insertRow(cols: Record<string, unknown>) {
  const row: Record<string, unknown> = { name: `Applicant ${++seq}`, email: `applicant${seq}@example.invalid`, expertise: "Latency.", ...cols };
  const keys = Object.keys(row);
  return sql(
    `insert into consultant_applications (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    keys.map((k) => row[k]),
  );
}
function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const count = async (where = "true", params: unknown[] = []) =>
  (await sql(`select count(*)::int n from consultant_applications where ${where}`, params)).rows[0].n as number;
const auditCount = async (id: string) =>
  (await sql(`select count(*)::int n from admin_actions where details_json->>'consultantApplicationId' = $1`, [id])).rows[0].n as number;

test("0112 applies on the real chain: the table exists and the ledger row is in", async () => {
  assert.notEqual((await sql(`select to_regclass('consultant_applications') as r`)).rows[0].r, null);
  assert.deepEqual((await sql(`select name from schema_migrations where version = '0112'`)).rows, [{ name: "0112_consultant_applications.sql" }]);
});

test("CHECKs: lengths, vocabularies, the decided stamp and the decline note", async () => {
  await refused(insertRow({ name: "" }), "23514", "consultant_applications_name_check");
  await refused(insertRow({ name: "x".repeat(121) }), "23514", "consultant_applications_name_check");
  await refused(insertRow({ telegram: "x" }), "23514", "consultant_applications_telegram_check");
  await refused(insertRow({ telegram: "x".repeat(65) }), "23514", "consultant_applications_telegram_check");
  await refused(insertRow({ expertise: "" }), "23514", "consultant_applications_expertise_check");
  await refused(insertRow({ expertise: "x".repeat(1001) }), "23514", "consultant_applications_expertise_check");
  await refused(insertRow({ background: "x".repeat(2001) }), "23514", "consultant_applications_background_check");
  await refused(insertRow({ status: "accepted", decided_at: new Date() }), "23514", "consultant_applications_status_check");
  await refused(insertRow({ status: "approved" }), "23514", "consultant_applications_decided_check");
  await refused(insertRow({ decided_at: new Date() }), "23514", "consultant_applications_decided_check");
  await refused(insertRow({ status: "declined", decided_at: new Date() }), "23514", "consultant_applications_decline_note_required");
  await refused(insertRow({ status: "declined", decided_at: new Date(), declined_note: "" }), "23514", "consultant_applications_declined_note_check");
  await insertRow({
    name: "x".repeat(120), telegram: "ab", expertise: "x".repeat(1000), background: "x".repeat(2000),
    profile_url: `https://${"x".repeat(292)}`, status: "declined", decided_at: new Date(), declined_note: "x".repeat(1000),
  });
});

test("CHECK email: lower(trim()), 3..254, an '@' after the first character (Fable S1)", async () => {
  for (const email of ["Upper@example.invalid", " pad@example.invalid", "pad@example.invalid ", "noat.example.invalid", "@example.invalid", "a@", `${"x".repeat(250)}@x.io`]) {
    await refused(insertRow({ email }), "23514", "consultant_applications_email_check");
  }
  await insertRow({ email: "a@b" });
});

test("CHECK profile_url: http(s) only, any case, at most 300 (Fable S2)", async () => {
  for (const profile_url of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "//evil.com", "ftp://x.io", " https://x.io", `https://${"x".repeat(293)}`]) {
    await refused(insertRow({ profile_url }), "23514", "consultant_applications_profile_url_check");
  }
  await insertRow({ profile_url: "http://x.io" });
  await insertRow({ profile_url: "HTTPS://X.IO/me" });
});

test("one open application per email: pending and approved both hold it, declined frees it, the race leaves one row", async () => {
  await insertRow({ email: "open@example.invalid" });
  await refused(insertRow({ email: "open@example.invalid" }), "23505", "consultant_applications_email_open_uidx");
  const race = await Promise.allSettled([insertRow({ email: "race@example.invalid" }), insertRow({ email: "race@example.invalid" })]);
  assert.deepEqual(race.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(await count(`email = 'race@example.invalid'`), 1);
  await sql(`update consultant_applications set status = 'approved', decided_at = now() where email = 'open@example.invalid'`);
  await refused(insertRow({ email: "open@example.invalid" }), "23505", "consultant_applications_email_open_uidx");
  await sql(`update consultant_applications set status = 'declined', decided_at = now(), declined_note = 'n' where email = 'race@example.invalid'`);
  await insertRow({ email: "race@example.invalid" });
});

// ---- the form path ----

test("parse: trims, stores the email lowercase, empty optionals are NULL", () => {
  const input = ca.parseConsultantApplication(form({ name: "  Ana  ", email: "  Ana.Mixed@Example.INVALID ", expertise: " FIX ", telegram: " ", background: "", profileUrl: "" }));
  assert.deepEqual(input, { name: "Ana", email: "ana.mixed@example.invalid", telegram: null, expertise: "FIX", background: null, profileUrl: null });
});

test("parse: refuses what 0112 refuses, 'javascript:' included, before any write", () => {
  const ok = { name: "Ana", email: "ana@example.invalid", expertise: "FIX" };
  const cases: Record<string, string>[] = [
    { ...ok, name: "" }, { ...ok, name: "x".repeat(121) }, { ...ok, email: "" }, { ...ok, email: "noat" }, { ...ok, email: "@x.io" },
    { ...ok, telegram: "x" }, { ...ok, telegram: "x".repeat(65) }, { ...ok, expertise: "" }, { ...ok, expertise: "x".repeat(1001) },
    { ...ok, background: "x".repeat(2001) }, { ...ok, profileUrl: "javascript:alert(1)" }, { ...ok, profileUrl: "data:text/html,x" },
    { ...ok, profileUrl: `https://${"x".repeat(293)}` },
  ];
  for (const c of cases) assert.throws(() => ca.parseConsultantApplication(form(c)), ca.ConsultantApplicationError, JSON.stringify(c).slice(0, 80));
  assert.equal(ca.parseConsultantApplication(form({ ...ok, profileUrl: "https://x.io/ana" })).profileUrl, "https://x.io/ana");
});

test("honeypot filled: a success result, zero rows, no card (Fable S5)", async () => {
  const rows = await count();
  const sends = telegramSends.length;
  const result = await runAction("x", () => ca.submitConsultantApplicationForm(form({ website: "http://spam.example", name: "Bot", email: "bot@example.invalid", expertise: "spam" })));
  assert.deepEqual(result, { ok: true });
  assert.equal(await count(), rows);
  assert.equal(await count(`email = 'bot@example.invalid'`), 0);
  assert.equal(telegramSends.length, sends);
});

test("submit: one row, lowercase email, no user_id even when an account matches, one capped text-only card, no receipt email", async () => {
  await sql(`insert into users (email) values ('Card.Person@Example.invalid')`);
  const sends = telegramSends.length;
  const mails = emails.length;
  const expertise = "e".repeat(299) + "XYZ";
  const result = await runAction("x", () => ca.submitConsultantApplicationForm(form({
    name: "Card Person", email: " Card.Person@EXAMPLE.invalid ", telegram: "@cardp", expertise,
    background: "SECRET-BACKGROUND", profileUrl: "https://x.io/SECRET-PROFILE",
  })));
  assert.deepEqual(result, { ok: true });
  const row = (await sql(`select * from consultant_applications where email = 'card.person@example.invalid'`)).rows[0];
  assert.ok(row, "stored lowercase and trimmed");
  assert.equal(row.user_id, null, "link at approve only (Fable ask 3)");
  assert.equal(row.status, "pending");
  assert.equal(emails.length, mails, "no receipt email (Fable ask 2)");

  const sent = telegramSends.slice(sends);
  assert.equal(sent.length, 1, "exactly one card");
  assert.equal(sent[0].chatId, "-1003914182493", "the approvals chat");
  assert.ok(sent[0].threadId != null, "the approvals topic");
  assert.equal(sent[0].hasButtons, false, "no buttons in S1a");
  assert.equal(
    sent[0].text,
    [
      "🧑‍💼 new consultant application",
      "name: Card Person",
      "email: card.person@example.invalid",
      "telegram: @cardp",
      `expertise: ${"e".repeat(299)}X…`,
      "review in the admin queue:",
      "https://portal.horizonhft.com/admin/consult-applications",
    ].join("\n"),
  );
  assert.doesNotMatch(sent[0].text, /SECRET-BACKGROUND|SECRET-PROFILE/);
});

test("submit: a second application for an open email is refused with the user-facing text, and sends nothing", async () => {
  const sends = telegramSends.length;
  const result = await runAction("x", () => ca.submitConsultantApplicationForm(form({ name: "Again", email: "CARD.person@example.invalid", expertise: "x" })));
  assert.deepEqual(result, { ok: false, error: "An application for this email is already in review or approved" });
  assert.equal(telegramSends.length, sends);
});

test("submit: 'javascript:' profile link refused, nothing written or sent", async () => {
  const sends = telegramSends.length;
  const result = await runAction("x", () => ca.submitConsultantApplicationForm(form({ name: "Js", email: "js@example.invalid", expertise: "x", profileUrl: "javascript:alert(1)" })));
  assert.equal(result.ok, false);
  assert.equal(await count(`email = 'js@example.invalid'`), 0);
  assert.equal(telegramSends.length, sends);
});

// ---- approve / decline ----

async function apply(email: string, name = "Applicant") {
  return ca.createConsultantApplication(ca.parseConsultantApplication(form({ name, email, expertise: "x" })));
}

test("approve: links the one account by the stored email (mixed case both sides, m65082 T3), stamps, audits, mails after commit", async () => {
  // A VERIFIED account: since S2 approve links only one (consult-s2-account.test.ts pins the unverified case).
  const user = (await sql(`insert into users (email, "emailVerified") values ('Mixed.Case@Example.invalid', now()) returning id`)).rows[0].id;
  const { id } = await apply("  MIXED.case@example.INVALID ", "Mia");
  assert.equal((await sql(`select email from consultant_applications where id = $1`, [id])).rows[0].email, "mixed.case@example.invalid");
  const mails = emails.length;
  await ca.approveConsultantApplication(id, ADMIN);
  const row = (await sql(`select * from consultant_applications where id = $1`, [id])).rows[0];
  assert.equal(row.status, "approved");
  assert.equal(row.user_id, user);
  assert.equal(row.decided_by, ADMIN);
  assert.ok(row.decided_at);
  const audit = (await sql(`select admin_user_id, action_type, target_user_id from admin_actions where details_json->>'consultantApplicationId' = $1`, [id])).rows;
  assert.deepEqual(audit, [{ admin_user_id: ADMIN, action_type: "consultant_application_approved", target_user_id: user }]);
  assert.deepEqual(emails.slice(mails), [{ to: "mixed.case@example.invalid", ...ca.consultantApprovedEmail("Mia") }]);
  // A second application for the approved email is refused (Fable S1, S5).
  await assert.rejects(apply("mixed.case@example.invalid"), /already in review or approved/);
});

test("approve: no account -> user_id NULL; a second approve or a decline after it throws and writes no second audit row", async () => {
  const { id } = await apply("nobody@example.invalid");
  await ca.approveConsultantApplication(id, ADMIN);
  assert.equal((await sql(`select user_id from consultant_applications where id = $1`, [id])).rows[0].user_id, null);
  const mails = emails.length;
  await assert.rejects(ca.approveConsultantApplication(id, ADMIN), /already approved/);
  await assert.rejects(ca.declineConsultantApplication(id, ADMIN, "late"), /already approved/);
  assert.equal(await auditCount(id), 1);
  assert.equal((await sql(`select status, declined_note from consultant_applications where id = $1`, [id])).rows[0].status, "approved");
  assert.equal(emails.length, mails, "no mail for a refused decision");
});

test("approve: two accounts share the email -> refused, row stays pending, no audit, no mail (provider :321 / partner :226 rows[0])", async () => {
  await sql(`insert into users (email) values ('Twin@example.invalid'), ('twin@EXAMPLE.invalid')`);
  const { id } = await apply("twin@example.invalid");
  const mails = emails.length;
  await assert.rejects(ca.approveConsultantApplication(id, ADMIN), /^Error: 2 accounts share this email, merge in \/admin\/users first$/);
  const row = (await sql(`select status, user_id, decided_at from consultant_applications where id = $1`, [id])).rows[0];
  assert.deepEqual(row, { status: "pending", user_id: null, decided_at: null });
  assert.equal(await auditCount(id), 0);
  assert.equal(emails.length, mails);
});

test("decline: a note is required; it is stored for admins and never in the applicant's mail (Fable S3); no account link", async () => {
  await sql(`insert into users (email) values ('declined.one@example.invalid')`);
  const { id } = await apply("declined.one@example.invalid", "Dee");
  for (const note of ["", "   "]) await assert.rejects(ca.declineConsultantApplication(id, ADMIN, note), /A note is required/);
  await assert.rejects(ca.declineConsultantApplication(id, ADMIN, "x".repeat(1001)), /up to 1000/);
  assert.equal((await sql(`select status from consultant_applications where id = $1`, [id])).rows[0].status, "pending");
  assert.equal(await auditCount(id), 0);

  const mails = emails.length;
  await ca.declineConsultantApplication(id, ADMIN, "  PRIVATE-NOTE weak track record  ");
  const row = (await sql(`select status, declined_note, decided_by, user_id from consultant_applications where id = $1`, [id])).rows[0];
  assert.deepEqual(row, { status: "declined", declined_note: "PRIVATE-NOTE weak track record", decided_by: ADMIN, user_id: null });
  const audit = (await sql(`select action_type from admin_actions where details_json->>'consultantApplicationId' = $1`, [id])).rows;
  assert.deepEqual(audit, [{ action_type: "consultant_application_declined" }]);
  const sent = emails.slice(mails);
  assert.deepEqual(sent, [{ to: "declined.one@example.invalid", ...ca.consultantDeclinedEmail("Dee") }]);
  assert.doesNotMatch(sent[0].text, /PRIVATE-NOTE/);
  await assert.rejects(ca.declineConsultantApplication(id, ADMIN, "again"), /already declined/);
  assert.equal(await auditCount(id), 1);
  // Declined may re-apply (Fable S1, S5).
  await apply("declined.one@example.invalid");
});

test("a Resend failure after commit can't fail or undo the decision (Fable S3)", async () => {
  const a = await apply("mail.down.a@example.invalid");
  const b = await apply("mail.down.b@example.invalid");
  resendDown = true;
  try {
    await ca.approveConsultantApplication(a.id, ADMIN);
    await ca.declineConsultantApplication(b.id, ADMIN, "n");
  } finally {
    resendDown = false;
  }
  const rows = (await sql(`select email, status from consultant_applications where id in ($1, $2) order by email`, [a.id, b.id])).rows;
  assert.deepEqual(rows, [{ email: "mail.down.a@example.invalid", status: "approved" }, { email: "mail.down.b@example.invalid", status: "declined" }]);
});

test("unknown id: refused, nothing written", async () => {
  await assert.rejects(ca.approveConsultantApplication("00000000-0000-4000-8000-000000000000", ADMIN), /not found/);
});

test("lists: newest first, filtered by status", async () => {
  const all = await ca.listConsultantApplications();
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].createdAt >= all[i].createdAt);
  const pending = await ca.listConsultantApplications({ status: "pending" });
  assert.ok(pending.length > 0 && pending.every((r) => r.status === "pending"));
  assert.equal(pending.length, all.filter((r) => r.status === "pending").length);
});

test("isSafeProfileUrl matches the 0112 CHECK", () => {
  for (const u of ["http://x.io", "HTTPS://x.io"]) assert.equal(ca.isSafeProfileUrl(u), true, u);
  for (const u of ["javascript:alert(1)", "//x.io", " https://x.io", "data:x"]) assert.equal(ca.isSafeProfileUrl(u), false, u);
});

// Last: it runs DDL against the shared database.
test("0112_rollback refuses while any application exists, then drops the table and the ledger row", async () => {
  const rollback = readFileSync(path.join(MIGRATIONS, "0112_rollback.sql"), "utf8");
  assert.ok((await count()) > 0, "earlier tests left rows");
  await assert.rejects(db.exec(rollback), /consultant_applications has rows/);
  await db.exec("rollback");
  assert.equal((await sql(`select count(*)::int n from schema_migrations where version = '0112'`)).rows[0].n, 1);
  await sql(`delete from consultant_applications`);
  await db.exec(rollback);
  assert.equal((await sql(`select to_regclass('consultant_applications') as r`)).rows[0].r, null);
  assert.equal((await sql(`select count(*)::int n from schema_migrations where version = '0112'`)).rows[0].n, 0);
});
