/* Run: npx tsx --test src/lib/consult-s4-requests.test.ts
 *
 * Consult S4 (foc16; marcus m71393): a signed-in client asks ONE listed service provider for help, stored in
 * consult_requests with 0116's provider_profile_id. Pinned here:
 *  - the form: a message (1..2000) with no prices or contact details (the public-text filter, naming "Message"); a
 *    Telegram handle only within 2..64;
 *  - only a provider that passes the listing gate at that moment (draft, hidden, declined: refused, nothing written);
 *    never your own profile;
 *  - the row: kind 'request', no package, provider_profile_id set, routed_to_user_id NULL (it means "accepted by");
 *  - one OPEN request per client per provider, refused in words; a closed one frees it;
 *  - telegram_handle stored only when the account has no Telegram on file;
 *  - ONE admin card per request: provider name + path, the client line, the admin list link; nothing goes to the
 *    provider;
 *  - the admin list shows the request with its provider.
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
let profiles: typeof import("./consultant-profiles");
let req: typeof import("./consult-provider-requests");
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
  profiles = await import("./consultant-profiles");
  req = await import("./consult-provider-requests");
  await sql(`insert into users (id, email, role) values ($1, 'admin@example.invalid', 'admin')`, [ADMIN]);
});

let seq = 0;
let appSeq = 0;
async function user(email: string, verified = true, telegram: string | null = null): Promise<string> {
  return (await sql(`insert into users (email, "emailVerified", telegram_username) values ($1, $2, $3) returning id`, [email, verified ? new Date() : null, telegram])).rows[0].id;
}
async function application(email: string, status: "pending" | "approved" | "declined"): Promise<string> {
  return (await sql(
    `insert into consultant_applications (name, email, expertise, status, decided_at, declined_note)
     values ($1, $2, 'Setup.', $3, $4, $5) returning id`,
    [`Provider ${++appSeq}`, email, status, status === "pending" ? null : new Date(), status === "declined" ? "note" : null],
  )).rows[0].id;
}
function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
}
const profileForm = (slug: string) =>
  form({ slug, displayName: "Pat Provider", headline: "MT5 setup", about: "Ten years of MT5 setups.", serviceTypes: "setup" });
/** A listed provider (approved, profile saved and shown); returns ids and the slug. */
async function provider(publish = true) {
  const n = ++seq;
  const slug = `prov-${n}`;
  const u = await user(`prov${n}@example.invalid`);
  const a = await application(`prov${n}@example.invalid`, "approved");
  const p = await profiles.saveOwnConsultantProfile(u, profiles.parseConsultantProfile(profileForm(slug)));
  if (publish) await profiles.setOwnConsultantProfilePublished(u, true);
  return { u, a, id: p.id, slug };
}
const ok = (message = "I need my MT5 server set up for gold.", telegram?: string) => form(telegram ? { message, telegram } : { message });
const rowsFor = async (clientId: string) => (await sql(`select * from consult_requests where user_id = $1 order by created_at`, [clientId])).rows;

test("form: a message is required and capped; Telegram 2..64; a price or a contact in the message is refused, naming Message", () => {
  for (const bad of [form({}), form({ message: "x".repeat(2001) }), ok("ok", "x"), ok("ok", "x".repeat(65))]) {
    assert.throws(() => req.parseProviderRequest(bad), req.ProviderRequestError);
  }
  for (const [text, why] of [["Budget $200 for this", /^Message: prices/], ["reach me at me@example.com", /^Message: contact details/], ["call +44 7700 900123", /^Message: contact details/]] as const) {
    assert.throws(() => req.parseProviderRequest(ok(text)), (e: any) => e instanceof req.ProviderRequestError && why.test(e.message) && /Horizon passes your request on\.$/.test(e.message), text);
  }
  assert.deepEqual(req.parseProviderRequest(ok("  Help with setup  ")), { message: "Help with setup", telegramHandle: null });
});

test("a request to a listed provider: one row (kind request, no package, provider_profile_id, routed_to_user_id NULL) and one admin card", async () => {
  const p = await provider();
  const client = await user(`client${++seq}@example.invalid`);
  const sends = telegramSends.length;
  await req.createProviderRequest(client, p.slug, req.parseProviderRequest(ok()));
  const rows = await rowsFor(client);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].kind, rows[0].service_id, rows[0].provider_profile_id, rows[0].routed_to_user_id, rows[0].status], ["request", null, p.id, null, "pending"]);
  const cards = telegramSends.slice(sends).map((s) => s.text);
  assert.equal(cards.length, 1);
  assert.match(cards[0], /service request/);
  assert.match(cards[0], new RegExp(`Pat Provider \\(/marketplace/services/${p.slug}\\)`));
  assert.match(cards[0], new RegExp(`client${seq}@example\\.invalid`), "admins see the client");
  assert.match(cards[0], /admin\/provider-requests/);
  assert.doesNotMatch(cards[0], new RegExp(`prov${p.slug.split("-")[1]}@example`), "the provider's email is not in the card");
});

test("not listed (draft, hidden, application declined) or your own profile: refused, nothing written", async () => {
  const client = await user(`client${++seq}@example.invalid`);
  const draft = await provider(false);
  const hidden = await provider();
  await profiles.setConsultantProfileHidden(hidden.id, true, ADMIN);
  const gone = await provider();
  await sql(`update consultant_applications set status = 'declined', declined_note = 'x' where id = $1`, [gone.a]);
  for (const p of [draft, hidden, gone]) {
    await assert.rejects(req.createProviderRequest(client, p.slug, req.parseProviderRequest(ok())), /not listed/, p.slug);
  }
  await assert.rejects(req.createProviderRequest(client, "no-such-provider", req.parseProviderRequest(ok())), /not listed/);
  const mine = await provider();
  await assert.rejects(req.createProviderRequest(mine.u, mine.slug, req.parseProviderRequest(ok())), /your own profile/);
  assert.equal((await rowsFor(client)).length, 0);
  assert.equal((await rowsFor(mine.u)).length, 0);
});

test("one OPEN request per client per provider, refused in words; closing it frees the next; another provider is fine", async () => {
  const p = await provider();
  const q = await provider();
  const client = await user(`client${++seq}@example.invalid`);
  await req.createProviderRequest(client, p.slug, req.parseProviderRequest(ok()));
  await assert.rejects(req.createProviderRequest(client, p.slug, req.parseProviderRequest(ok("Again"))), /already have an open request/);
  await req.createProviderRequest(client, q.slug, req.parseProviderRequest(ok()));
  await sql(`update consult_requests set status = 'closed' where user_id = $1 and provider_profile_id = $2`, [client, p.id]);
  await req.createProviderRequest(client, p.slug, req.parseProviderRequest(ok("A new one")));
  assert.equal((await rowsFor(client)).length, 3);
});

test("telegram_handle is stored only when the account has no Telegram on file", async () => {
  const p = await provider();
  const withTg = await user(`tg${++seq}@example.invalid`, true, "has_tg");
  const without = await user(`notg${seq}@example.invalid`);
  await req.createProviderRequest(withTg, p.slug, req.parseProviderRequest(ok("Hello", "@typed")));
  await req.createProviderRequest(without, p.slug, req.parseProviderRequest(ok("Hello", "@typed")));
  assert.equal((await rowsFor(withTg))[0].telegram_handle, null);
  assert.equal((await rowsFor(without))[0].telegram_handle, "@typed");
});

test("the admin list shows each provider request with its provider and client, newest first", async () => {
  const p = await provider();
  const client = await user(`list${++seq}@example.invalid`);
  await req.createProviderRequest(client, p.slug, req.parseProviderRequest(ok("Listed message")));
  const rows = await req.listProviderRequestsForAdmin();
  const mine = rows.find((r) => r.message === "Listed message");
  assert.ok(mine);
  assert.deepEqual([mine.providerSlug, mine.clientEmail, mine.status], [p.slug, `list${seq}@example.invalid`, "pending"]);
  assert.ok(rows.every((r) => r.providerSlug), "only provider requests are listed");
});
