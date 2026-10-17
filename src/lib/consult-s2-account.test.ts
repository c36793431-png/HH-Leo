/* Run: npx tsx --test src/lib/consult-s2-account.test.ts
 *
 * Consult S2 (foc16; marcus m71309 ACCOUNT DECISION, Fable to PASS the link step explicitly): a service provider's
 * account is the one they sign in with. Applying stays account-free. An application is linked to an account only by
 * an exact match on a VERIFIED email (users."emailVerified" set, which the magic-link sign-in does), and more than one
 * account on that email refuses. Pinned here:
 *  - resolveConsultantAccount: a linked row first; else the verified-email match, open application before a declined
 *    one; an approved unlinked row is linked at sign-in (user_id was NULL at approve); a pending one is shown and never
 *    linked (approve links it); unverified -> nothing linked; two accounts -> refused, nothing linked; a row linked to
 *    ANOTHER account is never shown; case-insensitive both sides; idempotent; the private decline note never returned.
 *  - approve: links only a VERIFIED account (an admin-created or Telegram-side unverified email no longer links); more
 *    than one account on the email still refuses.
 * Real Postgres, no prod: the PGlite harness of consultant-applications-0112.test.ts. */
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
const telegramSends: { chatId: string; threadId: unknown; text: string; hasButtons: boolean }[] = [];
const emails: { to: string; subject: string; text: string }[] = [];

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
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
  await sql(`insert into users (id, email, role) values ($1, 'admin@example.invalid', 'admin')`, [ADMIN]);
});

let seq = 0;
async function user(email: string | null, verified: boolean): Promise<string> {
  const r = await sql(`insert into users (email, "emailVerified") values ($1, $2) returning id`, [email, verified ? new Date() : null]);
  return r.rows[0].id;
}
async function application(email: string, status: "pending" | "approved" | "declined", userId: string | null = null): Promise<string> {
  const decided = status === "pending" ? null : new Date();
  const r = await sql(
    `insert into consultant_applications (name, email, expertise, status, decided_at, declined_note, user_id)
     values ($1, $2, 'Setup.', $3, $4, $5, $6) returning id`,
    [`Provider ${++seq}`, email, status, decided, status === "declined" ? "private note" : null, userId],
  );
  return r.rows[0].id;
}
const linkedTo = async (id: string) => (await sql(`select user_id from consultant_applications where id = $1`, [id])).rows[0].user_id as string | null;

test("approved, unlinked, verified email: shown as approved and linked at sign-in; a second call returns the same", async () => {
  const u = await user("ok1@example.invalid", true);
  const a = await application("ok1@example.invalid", "approved");
  const first = await ca.resolveConsultantAccount(u);
  assert.equal(first.state, "approved");
  assert.equal(first.state === "approved" && first.applicationId, a);
  assert.equal(await linkedTo(a), u);
  assert.deepEqual(await ca.resolveConsultantAccount(u), first);
  assert.equal(await linkedTo(a), u);
});

test("mixed case on both sides still matches (stored lower, account mixed)", async () => {
  const u = await user("Mixed.Case@Example.Invalid", true);
  const a = await application("mixed.case@example.invalid", "approved");
  assert.equal((await ca.resolveConsultantAccount(u)).state, "approved");
  assert.equal(await linkedTo(a), u);
});

test("pending: shown as pending, never linked at sign-in (approve links it)", async () => {
  const u = await user("pend@example.invalid", true);
  const a = await application("pend@example.invalid", "pending");
  assert.equal((await ca.resolveConsultantAccount(u)).state, "pending");
  assert.equal(await linkedTo(a), null);
});

test("declined only: shown as declined, never linked; the private note is not in the result", async () => {
  const u = await user("dec@example.invalid", true);
  const a = await application("dec@example.invalid", "declined");
  const r = await ca.resolveConsultantAccount(u);
  assert.equal(r.state, "declined");
  assert.doesNotMatch(JSON.stringify(r), /private note/);
  assert.equal(await linkedTo(a), null);
});

test("declined then applied again: the open application wins over the older declined one", async () => {
  const u = await user("again@example.invalid", true);
  await application("again@example.invalid", "declined");
  const open = await application("again@example.invalid", "pending");
  const r = await ca.resolveConsultantAccount(u);
  assert.equal(r.state, "pending");
  assert.equal(r.state === "pending" && r.applicationId, open);
});

test("unverified email: state unverified, nothing linked even when an approved row matches", async () => {
  const u = await user("unver@example.invalid", false);
  const a = await application("unver@example.invalid", "approved");
  assert.equal((await ca.resolveConsultantAccount(u)).state, "unverified");
  assert.equal(await linkedTo(a), null);
});

test("no email on the account (Telegram sign-in): state unverified", async () => {
  const u = await user(null, false);
  assert.equal((await ca.resolveConsultantAccount(u)).state, "unverified");
});

test("two accounts share the email: refused (shared-email), nothing linked", async () => {
  const u = await user("twice@example.invalid", true);
  await user("TWICE@example.invalid", false);
  const a = await application("twice@example.invalid", "approved");
  assert.equal((await ca.resolveConsultantAccount(u)).state, "shared-email");
  assert.equal(await linkedTo(a), null);
});

test("a row linked to ANOTHER account is never shown or re-linked", async () => {
  const other = await user("other-owner@example.invalid", true);
  const u = await user("taken@example.invalid", true);
  const a = await application("taken@example.invalid", "approved", other);
  assert.equal((await ca.resolveConsultantAccount(u)).state, "none");
  assert.equal(await linkedTo(a), other);
});

test("a row already linked to this account is shown even if the account's email is now different or unverified", async () => {
  const u = await user("moved@example.invalid", false);
  const a = await application("old-address@example.invalid", "approved", u);
  const r = await ca.resolveConsultantAccount(u);
  assert.equal(r.state, "approved");
  assert.equal(r.state === "approved" && r.applicationId, a);
});

test("no application for a verified account: state none", async () => {
  const u = await user("nobody@example.invalid", true);
  assert.equal((await ca.resolveConsultantAccount(u)).state, "none");
});

test("approve links only a VERIFIED account; an unverified match leaves user_id NULL for the sign-in link", async () => {
  const unverified = await user("adminmade@example.invalid", false);
  const a = await application("adminmade@example.invalid", "pending");
  await ca.approveConsultantApplication(a, ADMIN);
  assert.equal(await linkedTo(a), null);
  await sql(`update users set "emailVerified" = now() where id = $1`, [unverified]);
  assert.equal((await ca.resolveConsultantAccount(unverified)).state, "approved");
  assert.equal(await linkedTo(a), unverified);
});

test("approve still links a verified account, and still refuses two accounts on the email", async () => {
  const v = await user("verified-at-approve@example.invalid", true);
  const a = await application("verified-at-approve@example.invalid", "pending");
  await ca.approveConsultantApplication(a, ADMIN);
  assert.equal(await linkedTo(a), v);
  await user("dup@example.invalid", true);
  await user("Dup@example.invalid", false);
  const b = await application("dup@example.invalid", "pending");
  await assert.rejects(ca.approveConsultantApplication(b, ADMIN), /2 accounts share this email/);
});

test("approved email (marcus m71335 item 5): the consult host sign-in with the applicant's own address, no profile promise, no price", () => {
  const mail = ca.consultantApprovedEmail("Pat", "pat@example.invalid");
  assert.equal(mail.subject, "Your Horizon HFT service provider application");
  assert.equal(
    mail.text,
    "Hi Pat,\n\nYour application to offer your services through Horizon HFT has been approved.\n\n" +
      "Sign in at https://consult.horizonhft.com with this email address (pat@example.invalid) to see your account.\n\n" +
      "Horizon HFT",
  );
  assert.doesNotMatch(mail.text, /profile|marketplace|\$|price|USD|€|£/i);
});
