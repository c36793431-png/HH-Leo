/* Run: npx tsx --test src/lib/consult-s3-0116.test.ts
 *
 * Consult S3 (foc16; marcus m71309 order, m71301 profiles in the marketplace, m71305 any service provider, m71335 item 4):
 * migration 0116 (consultant_profiles + service types on consultant_applications) and lib/consultant-profiles.ts.
 * Pinned here:
 *  - 0116 applies on the real chain; rows from before it stay valid with service_types '{}'; the CHECKs: the one
 *    vocabulary (pinned to consult-service-types.ts), 'other' iff a name, a profile needs >= 1 type, the slug shape,
 *    the lengths; NO price / email / phone / telegram column on consultant_profiles.
 *  - the application form: at least one type, only from the list, no repeats kept, Other needs its name; stored.
 *  - saveOwnConsultantProfile: only the account's own APPROVED application, linked by the verified-email rule;
 *    pending / declined / none / unverified refused, nothing written; a second save updates the same row and never
 *    touches `published`; a taken slug is refused with the user-facing text.
 *  - THE LISTING GATE: approved AND published AND NOT admin_hidden, and the application linked to the profile's own
 *    account; each gate alone hides it; the listing carries no email or account id; the type filter; unknown slug.
 *  - publish ON needs the application still approved; OFF always works; admin hide/unhide is audited.
 *  - 0116_rollback refuses while a profile or a stated service type exists, then drops the table and the columns.
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
let profiles: typeof import("./consultant-profiles");
let types: typeof import("./consult-service-types");
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
  profiles = await import("./consultant-profiles");
  types = await import("./consult-service-types");
  await sql(`insert into users (id, email, role) values ($1, 'admin@example.invalid', 'admin')`, [ADMIN]);
});

let seq = 0;
let appSeq = 0; // the application() helper's own counter, so it never shifts a test's `seq`
async function user(email: string, verified = true): Promise<string> {
  return (await sql(`insert into users (email, "emailVerified") values ($1, $2) returning id`, [email, verified ? new Date() : null])).rows[0].id;
}
/** An application row (0116 columns default); approved rows are linked to `userId` when given. */
async function application(email: string, status: "pending" | "approved" | "declined", userId: string | null = null): Promise<string> {
  return (await sql(
    `insert into consultant_applications (name, email, expertise, status, decided_at, declined_note, user_id)
     values ($1, $2, 'Setup.', $3, $4, $5, $6) returning id`,
    [`Provider ${++appSeq}`, email, status, status === "pending" ? null : new Date(), status === "declined" ? "note" : null, userId],
  )).rows[0].id;
}
function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
}
const profileForm = (slug: string, extra: Record<string, string | string[]> = {}) =>
  form({ slug, displayName: "Pat Provider", headline: "MT5 setup and Horizon tuning", about: "Ten years of MT5 setups.", serviceTypes: ["setup", "consulting"], markets: "Gold, indices", platforms: "MT5", languages: "English", ...extra });
const count = async (table: string, where = "true", params: unknown[] = []) =>
  (await sql(`select count(*)::int n from ${table} where ${where}`, params)).rows[0].n as number;

/** An approved provider with a saved profile; returns ids. */
async function provider(slug: string, publish = true) {
  const u = await user(`${slug}@example.invalid`);
  const a = await application(`${slug}@example.invalid`, "approved");
  const p = await profiles.saveOwnConsultantProfile(u, profiles.parseConsultantProfile(profileForm(slug)));
  if (publish) await profiles.setOwnConsultantProfilePublished(u, true);
  return { u, a, id: p.id };
}
const listedSlugs = async (type: any = null) => (await profiles.listListedConsultantProfiles(type)).map((p) => p.slug);

test("0116 applies on the real chain: the table, the two columns, the ledger row; old rows keep '{}'", async () => {
  assert.notEqual((await sql(`select to_regclass('consultant_profiles') as r`)).rows[0].r, null);
  assert.deepEqual((await sql(`select name from schema_migrations where version = '0116'`)).rows, [{ name: "0116_consultant_profiles.sql" }]);
  const id = await application(`old${Date.now()}@example.invalid`, "pending");
  assert.deepEqual((await sql(`select service_types, service_other from consultant_applications where id = $1`, [id])).rows[0], { service_types: [], service_other: null });
});

test("the vocabulary CHECK is the consult-service-types.ts list, on both tables", async () => {
  for (const name of ["consultant_applications_service_types_check", "consultant_profiles_service_types_check"]) {
    const def = (await sql(`select pg_get_constraintdef(oid) d from pg_constraint where conname = $1`, [name])).rows[0].d as string;
    const literal = [...def.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]);
    assert.deepEqual(literal, [...types.CONSULT_SERVICE_TYPES], name);
  }
});

test("consultant_profiles has no price, email, phone or telegram column", async () => {
  const cols = (await sql(`select column_name from information_schema.columns where table_name = 'consultant_profiles' order by column_name`)).rows.map((r) => r.column_name);
  assert.deepEqual(cols, ["about", "admin_hidden", "application_id", "created_at", "display_name", "headline", "id", "languages", "markets", "platforms", "published", "service_other", "service_types", "slug", "updated_at", "user_id"]);
});

test("CHECKs: unknown type, 'other' without a name, a name without 'other', an empty profile type list, a bad slug, lengths", async () => {
  const a = await application(`chk${++seq}@example.invalid`, "pending");
  for (const [types_, other] of [[["consulting", "price"], null], [["other"], null], [["coding"], "x"]] as const) {
    await assert.rejects(sql(`update consultant_applications set service_types = $2, service_other = $3 where id = $1`, [a, types_, other]), JSON.stringify([types_, other]));
  }
  const u = await user(`chk${++seq}@example.invalid`);
  const ap = await application(`chk${seq}@example.invalid`, "approved", u);
  const base = { slug: `ok-${seq}`, dn: "N", hl: "H", ab: "A", st: ["consulting"], so: null as string | null };
  const ins = (o: Partial<typeof base>) => {
    const r = { ...base, ...o };
    return sql(`insert into consultant_profiles (user_id, application_id, slug, display_name, headline, about, service_types, service_other) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [u, ap, r.slug, r.dn, r.hl, r.ab, r.st, r.so]);
  };
  for (const bad of [{ st: [] }, { st: ["fx"] }, { st: ["other"] }, { slug: "Bad Slug" }, { slug: "-x" }, { slug: "a".repeat(65) }, { dn: "" }, { dn: "x".repeat(81) }, { hl: "x".repeat(121) }, { ab: "x".repeat(2001) }]) {
    await assert.rejects(ins(bad as any), JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(await count("consultant_profiles", "user_id = $1", [u]), 0);
});

test("application form: at least one type, only from the list, Other needs its name; stored in list order", async () => {
  const ok = { name: "Ana", email: `ana${++seq}@example.invalid`, expertise: "FIX" };
  const bads: Record<string, string | string[]>[] = [{}, { serviceTypes: "fx" }, { serviceTypes: ["other"] }, { serviceTypes: ["other"], serviceOther: "x".repeat(201) }];
  for (const bad of bads) {
    assert.throws(() => ca.parseConsultantApplication(form({ ...ok, ...bad })), ca.ConsultantApplicationError, JSON.stringify(bad));
  }
  const input = ca.parseConsultantApplication(form({ ...ok, serviceTypes: ["other", "coding", "coding"], serviceOther: "  Bots  " }));
  assert.deepEqual([input.serviceTypes, input.serviceOther], [["coding", "other"], "Bots"]);
  // A stray name without Other is dropped, not stored.
  assert.equal(ca.parseConsultantApplication(form({ ...ok, serviceTypes: "setup", serviceOther: "ignored" })).serviceOther, null);
  const { id } = await ca.createConsultantApplication(input);
  assert.deepEqual((await sql(`select service_types, service_other from consultant_applications where id = $1`, [id])).rows[0], { service_types: ["coding", "other"], service_other: "Bots" });
});

test("save: only the account's own APPROVED application; pending, declined, none and unverified are refused and write nothing", async () => {
  for (const [state, setup] of [
    ["pending", async (e: string) => { const u = await user(e); await application(e, "pending"); return u; }],
    ["declined", async (e: string) => { const u = await user(e); await application(e, "declined"); return u; }],
    ["none", async (e: string) => user(e)],
    ["unverified", async (e: string) => { const u = await user(e, false); await application(e, "approved"); return u; }],
  ] as const) {
    const u = await setup(`${state}${++seq}@example.invalid`);
    await assert.rejects(profiles.saveOwnConsultantProfile(u, profiles.parseConsultantProfile(profileForm(`${state}-${seq}`))), profiles.ConsultantProfileError, state);
    assert.equal(await count("consultant_profiles", "user_id = $1", [u]), 0, state);
  }
});

test("save: approved + verified email links the application and creates the profile, unpublished; a second save updates the same row and keeps `published`", async () => {
  const u = await user(`first${++seq}@example.invalid`);
  const a = await application(`first${seq}@example.invalid`, "approved");
  const p1 = await profiles.saveOwnConsultantProfile(u, profiles.parseConsultantProfile(profileForm(`first-${seq}`)));
  assert.equal(p1.published, false);
  assert.equal((await sql(`select user_id from consultant_applications where id = $1`, [a])).rows[0].user_id, u);
  await profiles.setOwnConsultantProfilePublished(u, true);
  const p2 = await profiles.saveOwnConsultantProfile(u, profiles.parseConsultantProfile(profileForm(`first-${seq}`, { headline: "New headline" })));
  assert.equal(p2.id, p1.id);
  assert.equal(p2.headline, "New headline");
  assert.equal(p2.published, true);
  assert.equal(await count("consultant_profiles", "user_id = $1", [u]), 1);
});

test("save: a taken slug is refused with the user-facing text; a bad slug never reaches the DB", async () => {
  await provider(`taken-${++seq}`);
  const u = await user(`second${seq}@example.invalid`);
  await application(`second${seq}@example.invalid`, "approved");
  await assert.rejects(profiles.saveOwnConsultantProfile(u, profiles.parseConsultantProfile(profileForm(`taken-${seq}`))), /That profile address is taken/);
  assert.throws(() => profiles.parseConsultantProfile(profileForm("Not A Slug")), profiles.ConsultantProfileError);
  assert.throws(() => profiles.parseConsultantProfile(profileForm("apply")), profiles.ConsultantProfileError);
});

test("THE LISTING GATE: approved AND published AND not hidden; each gate alone hides it", async () => {
  const live = await provider(`live-${++seq}`);
  const draft = await provider(`draft-${seq}`, false);
  const hidden = await provider(`hidden-${seq}`);
  await profiles.setConsultantProfileHidden(hidden.id, true, ADMIN);
  const gone = await provider(`gone-${seq}`);
  await sql(`update consultant_applications set status = 'declined', declined_note = 'later' where id = $1`, [gone.a]);
  const moved = await provider(`moved-${seq}`);
  await sql(`update consultant_applications set user_id = $2 where id = $1`, [moved.a, await user(`other${seq}@example.invalid`)]);
  const slugs = await listedSlugs();
  assert.ok(slugs.includes(`live-${seq}`));
  for (const s of [`draft-${seq}`, `hidden-${seq}`, `gone-${seq}`, `moved-${seq}`]) {
    assert.ok(!slugs.includes(s), s);
    assert.equal(await profiles.getListedConsultantProfile(s), null, s);
  }
  assert.equal((await profiles.getListedConsultantProfile(`live-${seq}`))?.displayName, "Pat Provider");
  void live; void draft;
});

test("the listing carries no email, account id, application id or admin flag", async () => {
  const p = await provider(`private-${++seq}`);
  const listed = await profiles.getListedConsultantProfile(`private-${seq}`);
  assert.ok(listed);
  const text = JSON.stringify(listed);
  assert.doesNotMatch(text, /@example\.invalid/);
  assert.doesNotMatch(text, new RegExp(p.u));
  assert.doesNotMatch(text, new RegExp(p.a));
  assert.deepEqual(Object.keys(listed).sort(), ["about", "displayName", "headline", "languages", "markets", "platforms", "serviceOther", "serviceTypes", "slug"]);
});

test("the type filter: only profiles offering it; serviceTypeFilter turns anything unknown into no filter", async () => {
  const c = await provider(`coder-${++seq}`, false);
  await profiles.saveOwnConsultantProfile(c.u, profiles.parseConsultantProfile(profileForm(`coder-${seq}`, { serviceTypes: "coding" })));
  await profiles.setOwnConsultantProfilePublished(c.u, true);
  assert.ok((await listedSlugs("coding")).includes(`coder-${seq}`));
  assert.ok(!(await listedSlugs("setup")).includes(`coder-${seq}`));
  assert.equal(types.serviceTypeFilter("coding"), "coding");
  for (const v of ["price", "", "Coding", undefined, ["coding"]]) assert.equal(types.serviceTypeFilter(v as any), null, String(v));
});

test("publish ON needs the application still approved; OFF always works; admin hide/unhide is audited", async () => {
  const p = await provider(`pub-${++seq}`, false);
  await sql(`update consultant_applications set status = 'declined', declined_note = 'x' where id = $1`, [p.a]);
  await assert.rejects(profiles.setOwnConsultantProfilePublished(p.u, true), profiles.ConsultantProfileError);
  await profiles.setOwnConsultantProfilePublished(p.u, false);
  const q = await provider(`aud-${seq}`);
  await profiles.setConsultantProfileHidden(q.id, true, ADMIN);
  await profiles.setConsultantProfileHidden(q.id, false, ADMIN);
  const audit = (await sql(`select action_type from admin_actions where details_json->>'consultantProfileId' = $1 order by created_at`, [q.id])).rows.map((r) => r.action_type);
  assert.deepEqual(audit, ["consultant_profile_hidden", "consultant_profile_unhidden"]);
  assert.ok((await listedSlugs()).includes(`aud-${seq}`));
});

test("suggestConsultSlug: a valid address from a name, or 'provider'", () => {
  const cases: [string, string][] = [["Pat Provider", "pat-provider"], ["  José  Núñez ", "jose-nunez"], ["A & B -- Ltd.", "a-b-ltd"], ["!!!", "provider"], ["apply", "provider"], ["x".repeat(80), "x".repeat(64)], [`${"a".repeat(63)} b`, "a".repeat(63)]];
  for (const [name, want] of cases) assert.equal(profiles.suggestConsultSlug(name), want, name);
});

test("public text (marcus m71369 1a): prices, emails, links, @handles and phone numbers are refused; ordinary text passes", async () => {
  const pt = await import("./consult-public-text");
  const refused: [string, RegExp][] = [
    ["Setups from $50", /prices/], ["50$ per setup", /prices/], ["€40 a call", /prices/], ["30 EUR", /prices/], ["USD 25", /prices/],
    ["100 dollars", /prices/], ["2k usdt", /prices/], ["£20/hr", /prices/], ["20/hr", /prices/], ["billed per hour", /prices/], ["my hourly rate is fair", /prices/],
    ["mail me: pat@example.com", /email/], ["see https://pat.dev", /links/], ["www.pat.io", /links/], ["t.me/patsetups", /links/], ["patsetups.com", /links/],
    ["DM @patsetups", /@handle/], ["call +44 7700 900123", /phone/], ["(555) 123-4567 89", /phone/],
  ];
  for (const [text, why] of refused) assert.match(pt.publicTextProblem(text) ?? "PASSED", why, text);
  const fine = [
    "MT5 setup and Horizon 2.0.9 tuning", "Ten years of MT5 servers, 2015-2024", "Gold, indices, FX", "MT4, MT5, Horizon", "English, Spanish",
    "Low latency @ 2 ms", "ASP.NET and Socket.io bots", "1:500 leverage accounts", "24/7 monitoring", "Python, C#, MQL5", "Copier installs",
  ];
  for (const text of fine) assert.equal(pt.publicTextProblem(text), null, text);
});

test("save refuses a public field with a price or a contact, naming the field; nothing is written", async () => {
  const u = await user(`pt${++seq}@example.invalid`);
  await application(`pt${seq}@example.invalid`, "approved");
  const cases: [Record<string, string | string[]>, RegExp][] = [
    [{ about: "Setups from $50" }, /^About: prices/], [{ headline: "Email pat@example.com" }, /^Headline: contact details/],
    [{ displayName: "Pat @patsetups" }, /^Name: contact details/], [{ markets: "see www.pat.io" }, /^Markets: links/],
    [{ platforms: "MT5 20/hr" }, /^Platforms: prices/], [{ languages: "+44 7700 900123" }, /^Languages: contact details/],
    [{ serviceTypes: ["other"], serviceOther: "bots from 99 USD" }, /^Other service: prices/],
  ];
  for (const [extra, why] of cases) {
    assert.throws(() => profiles.parseConsultantProfile(profileForm(`pt-${seq}`, extra)), (e: any) => e instanceof profiles.ConsultantProfileError && why.test(e.message), JSON.stringify(extra));
  }
  assert.equal(await count("consultant_profiles", "user_id = $1", [u]), 0);
});

test("admin TG (marcus m71369 1b): one card when a profile is shown, one when a shown profile is edited; none for a draft", async () => {
  const base = telegramSends.length;
  const p = await provider(`tg-${++seq}`, false);
  const cards = () => telegramSends.slice(base).map((s) => s.text);
  assert.equal(cards().length, 0, "saving a draft sends nothing");
  await profiles.saveOwnConsultantProfile(p.u, profiles.parseConsultantProfile(profileForm(`tg-${seq}`, { headline: "Draft edit" })));
  assert.equal(cards().length, 0, "editing a draft sends nothing");
  await profiles.setOwnConsultantProfilePublished(p.u, true);
  assert.equal(cards().length, 1);
  assert.match(cards()[0], /profile now shown/);
  assert.match(cards()[0], new RegExp(`/marketplace/services/tg-${seq}`));
  assert.match(cards()[0], /admin\/consult-applications/);
  await profiles.setOwnConsultantProfilePublished(p.u, true);
  assert.equal(cards().length, 1, "showing an already shown profile sends nothing");
  await profiles.saveOwnConsultantProfile(p.u, profiles.parseConsultantProfile(profileForm(`tg-${seq}`, { headline: "Live edit" })));
  assert.equal(cards().length, 2);
  assert.match(cards()[1], /shown profile edited/);
  assert.match(cards()[1], /Pat Provider/);
  await profiles.setOwnConsultantProfilePublished(p.u, false);
  await profiles.saveOwnConsultantProfile(p.u, profiles.parseConsultantProfile(profileForm(`tg-${seq}`, { headline: "Hidden edit" })));
  assert.equal(cards().length, 2, "hiding and editing a hidden profile sends nothing");
  for (const c of cards()) assert.doesNotMatch(c, /@example\.invalid/, "no email in the card");
});

test("0116 consult_requests.provider_profile_id (marcus m71393): a provider request needs no package; one OPEN request per client per provider", async () => {
  const p = await provider(`req-${++seq}`);
  const client = await user(`client${seq}@example.invalid`);
  const ins = (kind: string, profileId: string | null, status = "pending") =>
    sql(`insert into consult_requests (user_id, kind, body, provider_profile_id, status) values ($1, $2, 'Need a setup.', $3, $4) returning id`, [client, kind, profileId, status]);
  // No package and not a question: refused unless it names a provider profile (the widened consult_requests_service_check).
  await assert.rejects(ins("request", null), /consult_requests_service_check/);
  const first = (await ins("request", p.id)).rows[0].id;
  // One open request per (client, provider): pending and accepted both hold it; declined / answered / closed free it.
  await assert.rejects(ins("request", p.id), /consult_requests_one_open_provider_uidx/);
  await sql(`update consult_requests set status = 'accepted' where id = $1`, [first]);
  await assert.rejects(ins("request", p.id), /consult_requests_one_open_provider_uidx/);
  await sql(`update consult_requests set status = 'closed' where id = $1`, [first]);
  await ins("request", p.id);
  // A profile with requests cannot be deleted from under them (ON DELETE RESTRICT).
  await assert.rejects(sql(`delete from consultant_profiles where id = $1`, [p.id]), /foreign key|violates/);
  // A plain question still needs neither a package nor a provider (0105 unchanged for it).
  await sql(`insert into consult_requests (user_id, kind, body) values ($1, 'question', 'Hi')`, [client]);
});

test("0116_rollback refuses while a provider request, a profile or a stated service type exists, then restores 0105 and drops the rest", async () => {
  const rollback = readFileSync(path.join(MIGRATIONS, "0116_rollback.sql"), "utf8");
  await assert.rejects(db.exec(rollback), /consult_requests rows name a provider profile/);
  await db.exec(`rollback`).catch(() => {});
  await sql(`delete from consult_requests where provider_profile_id is not null`);
  await assert.rejects(db.exec(rollback), /consultant_profiles has rows/);
  await db.exec(`rollback`).catch(() => {});
  await sql(`delete from consultant_profiles`);
  await assert.rejects(db.exec(rollback), /state service types/);
  await db.exec(`rollback`).catch(() => {});
  await sql(`update consultant_applications set service_types = '{}', service_other = null`);
  await db.exec(rollback);
  assert.equal((await sql(`select to_regclass('consultant_profiles') as r`)).rows[0].r, null);
  assert.equal(await count("information_schema.columns", "table_name = 'consultant_applications' and column_name in ('service_types', 'service_other')"), 0);
  assert.equal(await count("information_schema.columns", "table_name = 'consult_requests' and column_name = 'provider_profile_id'"), 0);
  // 0105's own CHECK is back, exactly: a request without a package is a question.
  const def = (await sql(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'consult_requests_service_check'`)).rows[0].d as string;
  assert.match(def, /service_id IS NOT NULL\) OR \(kind = 'question'::text\)\)\)$/);
  assert.doesNotMatch(def, /provider_profile_id/);
  assert.equal(await count("schema_migrations", "version = '0116'"), 0);
});
