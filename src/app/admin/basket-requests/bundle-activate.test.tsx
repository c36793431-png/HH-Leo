/* Run: npx tsx --test --experimental-test-module-mocks src/app/admin/basket-requests/bundle-activate.test.tsx
 *
 * Bundles S3, the admin "Activate bundle…" control (plan m70272, Fable m70330 S1/S2/C1-C8, BUILD GO marcus m70329).
 * The REAL server action activateBundleAction, driven with auth() and next/cache mocked, on in-memory PGlite over the
 * real migration chain (the activate-bundle-cli.test.ts harness: a pool query while a client holds an open
 * transaction THROWS). Sends are captured, never made. T1-T9 as in the plan, T5 = Fable S1, the key test = S2. */
import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { renderToStaticMarkup } from "react-dom/server";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const SEED_PROVIDER = "00000000-0000-4000-8000-0000000000a1";
const ADMIN = "00000000-0000-4000-8000-00000000d002";
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
const ENV = {
  NEON_DATABASE_URL: "postgres://unused",
  HORIZON_PORTAL_BOT_TOKEN: "portal-token",
  AUTH_RESEND_KEY: "re_test",
  EMAIL_FROM: "Horizon <noreply@example.invalid>",
  TELEMETRY_BOT_TOKEN: "telemetry-token",
};
const ADMIN_SESSION = { user: { id: ADMIN, email: "hfthorizon@keemail.me", role: "admin", roles: ["admin"] } };

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let actions: typeof import("./actions");
let cli: typeof import("../../../lib/activate-bundle-cli");
let lic: typeof import("../../../lib/licenses");
let bundles: typeof import("../../../lib/bundles");
let form: typeof import("../../../components/admin/bundle-activate-form");
let ui: typeof import("../../../lib/bundle-activate-ui");
let session: any = ADMIN_SESSION;
let emailRefused = false;
const sends: { kind: "portal" | "telemetry" | "email"; to: string; text: string; subject?: string }[] = [];

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
  let openTx = 0;
  const clientQuery = async (text: string, params: unknown[] = []) => {
    const verb = text.trim().toLowerCase();
    if (verb === "begin") openTx++;
    const r = await sql(text, params);
    if (verb === "commit" || verb === "rollback") openTx--;
    return r;
  };
  (globalThis as any)._pgPool = {
    query: async (text: string, params: unknown[] = []) => {
      if (openTx > 0) throw new Error(`pool query inside an open transaction: ${text.trim().slice(0, 80)}`);
      return sql(text, params);
    },
    connect: async () => ({ query: clientQuery, release() {} }),
    end: async () => {},
  };
  Object.assign(process.env, ENV);
  (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (u.includes(`/bot${ENV.HORIZON_PORTAL_BOT_TOKEN}/sendMessage`)) sends.push({ kind: "portal", to: String(body.chat_id), text: body.text });
    else if (u.includes(`/bot${ENV.TELEMETRY_BOT_TOKEN}/sendMessage`)) sends.push({ kind: "telemetry", to: String(body.chat_id), text: body.text });
    else if (u.includes("resend.com")) {
      if (emailRefused) {
        return new Response(JSON.stringify({ statusCode: 422, name: "validation_error", message: "Invalid `to` field." }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      }
      sends.push({ kind: "email", to: [body.to].flat().join(","), text: body.text, subject: body.subject });
    } else throw new Error(`unexpected outbound fetch: ${u}`);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 4242 }, id: "email-id" }), { status: 200 });
  };
  mock.module("@/lib/auth", { namedExports: { auth: async () => session } });
  mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
  actions = await import("./actions");
  cli = await import("../../../lib/activate-bundle-cli");
  lic = await import("../../../lib/licenses");
  bundles = await import("../../../lib/bundles");
  form = await import("../../../components/admin/bundle-activate-form");
  ui = await import("../../../lib/bundle-activate-ui");
  await sql(`insert into users (id, email, role) values ($1, 'hfthorizon@keemail.me', 'admin')`, [ADMIN]);
  await db.exec(readFileSync(path.join(process.cwd(), "scripts/seed-agent-actor.sql"), "utf8"));
});

let seq = 0;
async function makeUser(opts: { email?: string | null } = {}) {
  seq++;
  const email = opts.email === undefined ? `bundlebtn${seq}@example.invalid` : opts.email;
  const r = await sql(`insert into users (email) values ($1) returning id`, [email]);
  return { id: r.rows[0].id as string, email };
}

const LD = { kind: "bundle", key: "horizon-complete", name: "Horizon Complete (feed: London · Base)", feed: "ld-base" };
async function makeBasket(userId: string, lines: Record<string, unknown>[] = [LD]) {
  return (await sql(`insert into basket_requests (user_id, lines) values ($1, $2) returning id`, [userId, JSON.stringify(lines)])).rows[0].id as string;
}

/** Every table an activation can write, plus the sends. */
async function counts() {
  const r = await sql(
    `select (select count(*) from licenses)::int as licences,
            (select count(*) from bundle_subscriptions)::int as bundles,
            (select count(*) from payments)::int as payments,
            (select count(*) from admin_actions)::int as actions,
            (select count(*) from client_notices)::int as notices,
            (select count(*) from basket_requests where status = 'handled')::int as handled,
            (select count(*) from users)::int as users`
  );
  return { ...r.rows[0], sends: sends.length };
}

function fd(o: Record<string, string | undefined>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) if (v !== undefined) f.append(k, v);
  return f;
}
const fields = (userId: string, basketId: string, extra: Record<string, string | undefined> = {}) =>
  fd({ id: basketId, user: userId, bundle: "horizon-complete", feed: "ld-base", trial: "1", days: "30", mode: "activate", ...extra });

const act = (f: FormData) => actions.activateBundleAction(null, f);

test("T1 a non-admin, or no session, gets forbidden and nothing is written", async () => {
  const u = await makeUser();
  const basketId = await makeBasket(u.id);
  const c0 = await counts();
  try {
    session = { user: { id: u.id, email: u.email, role: "user", roles: ["user"] } };
    assert.deepEqual(await act(fields(u.id, basketId)), { kind: "error", error: "forbidden" });
    session = null;
    assert.deepEqual(await act(fields(u.id, basketId)), { kind: "error", error: "forbidden" });
  } finally {
    session = ADMIN_SESSION;
  }
  assert.deepEqual(await counts(), c0);
});

test("T2 Check reads only: the CLI dry run's facts, no refusals, 0 rows anywhere, no send", async () => {
  const u = await makeUser();
  const basketId = await makeBasket(u.id);
  const c0 = await counts();
  const s = await act(fields(u.id, basketId, { mode: "check" }));
  assert.deepEqual(await counts(), c0);
  assert.equal(s?.kind, "plan");
  if (s?.kind !== "plan") return;
  assert.deepEqual(s.refusals, []);
  assert.equal(s.check.user.id, u.id);
  assert.equal(s.check.delivery, "email");
  assert.equal(s.check.basket?.status, "new");
  assert.equal(s.check.basket?.bundleLine, "horizon-complete (ld-base)");
  assert.deepEqual(s.check.tiers.map((t) => t.tierKey), ["ld-beta-56", "ld-gamma-19", "ld-delta-18"]);
  assert.match(s.check.maskedMessage, /HHFT-XXXXXX-XXXXXX-XXXXXX/);
});

test("T3 Activate with a refusal present: the plan comes back with the coded refusal, 0 writes", async () => {
  const u = await makeUser();
  await sql(`insert into licenses (user_id, license_key, expires_at, tier) values ($1, $2, now() + interval '5 days', 'paid')`, [u.id, `BTN-LIVE-${seq}`]);
  const basketId = await makeBasket(u.id);
  const c0 = await counts();
  const s = await act(fields(u.id, basketId));
  assert.deepEqual(await counts(), c0);
  assert.equal(s?.kind, "plan", JSON.stringify(s));
  if (s?.kind !== "plan") return;
  assert.deepEqual(s.refusals.map((r) => r.code), ["live_licence"]);
});

test("T4 + S2 trial happy path: the admin is the actor everywhere, via 'admin'; the state holds the masked key, never the key", async () => {
  const u = await makeUser();
  const basketId = await makeBasket(u.id);
  const before = sends.length;
  const s = await act(fields(u.id, basketId));
  await lic.settleLicenseBackgroundTasks();
  assert.equal(s?.kind, "done", JSON.stringify(s));
  if (s?.kind !== "done") return;

  const licence = (await sql(`select id, license_key, tier from licenses where user_id = $1`, [u.id])).rows;
  assert.equal(licence.length, 1);
  assert.equal(licence[0].tier, "trial");
  const bundle = (await sql(`select id, activated_by, is_trial, basket_request_id from bundle_subscriptions where user_id = $1`, [u.id])).rows[0];
  assert.deepEqual(bundle, { id: s.result.bundleId, activated_by: ADMIN, is_trial: true, basket_request_id: basketId });
  const logged = (await sql(`select admin_user_id, details_json from admin_actions where action_type = 'bundle_activate' and target_user_id = $1`, [u.id])).rows;
  assert.equal(logged.length, 1);
  assert.equal(logged[0].admin_user_id, ADMIN);
  assert.equal(logged[0].details_json.via, "admin");
  const delivery = (await sql(`select admin_user_id, details_json from admin_actions where action_type = 'license_key_delivery' and target_license_id = $1`, [licence[0].id])).rows;
  assert.equal(delivery.length, 1);
  assert.equal(delivery[0].admin_user_id, ADMIN);
  const basket = (await sql(`select status, handled_by from basket_requests where id = $1`, [basketId])).rows[0];
  assert.deepEqual(basket, { status: "handled", handled_by: ADMIN });
  const emails = sends.slice(before).filter((x) => x.kind === "email" && x.to === u.email);
  assert.equal(emails.length, 1, "step 2: the key went out");
  assert.ok(emails[0].text.includes(licence[0].license_key));

  // S2: the key never leaves the server.
  const key = licence[0].license_key as string;
  assert.ok(!JSON.stringify(s).includes(key), "the full key is not in the action's state");
  assert.equal(s.result.maskedKey, lic.maskLicenseKey(key));
  assert.deepEqual(Object.keys(s.result).sort(), ["adminRow", "basketMarked", "bundleId", "expiresAt", "hh", "keySend", "maskedKey", "outcome"]);
  assert.deepEqual(s.result.keySend, { ok: true, channel: "email", error: null });
  assert.equal(s.result.basketMarked, true);
});

test("T5 (Fable S1) Paid is refused on the server before any plan, even with an amount; no pick is refused too; 0 writes", async () => {
  const u = await makeUser();
  const basketId = await makeBasket(u.id);
  const c0 = await counts();
  assert.deepEqual(await act(fields(u.id, basketId, { trial: "0", amountUsd: "100" })), { kind: "error", error: (await import("../../../lib/admin-bundle-activate")).PAID_NEEDS_N1 });
  const none = await act(fields(u.id, basketId, { trial: undefined }));
  assert.equal(none?.kind, "error");
  assert.deepEqual(await counts(), c0);
});

test("days: no default, and a trial is capped at MAX_TRIAL_DAYS (90) on the button; 0 writes", async () => {
  const u = await makeUser();
  const basketId = await makeBasket(u.id);
  const c0 = await counts();
  assert.deepEqual(await act(fields(u.id, basketId, { days: "91" })), { kind: "error", error: "A trial is at most 90 days, got 91" });
  assert.deepEqual(await act(fields(u.id, basketId, { days: undefined })), { kind: "error", error: "--days is required (no default)" });
  assert.deepEqual(await counts(), c0);
});

test("T6 the basket is handled between Check and Activate: the re-plan refuses it, 0 writes", async () => {
  const u = await makeUser();
  const basketId = await makeBasket(u.id);
  const checked = await act(fields(u.id, basketId, { mode: "check" }));
  assert.equal(checked?.kind === "plan" && checked.refusals.length, 0);
  await sql(`update basket_requests set status = 'handled', handled_at = now() where id = $1`, [basketId]);
  const c0 = await counts();
  const s = await act(fields(u.id, basketId));
  assert.deepEqual(await counts(), c0);
  assert.equal(s?.kind, "plan");
  if (s?.kind === "plan") assert.deepEqual(s.refusals.map((r) => r.code), ["basket_not_new"]);
});

test("C5 the user is gone: rendered as a refusal, not a crash", async () => {
  const s = await act(fields("00000000-0000-4000-8000-00000000dead", "00000000-0000-4000-8000-00000000beef"));
  assert.deepEqual(s, { kind: "error", error: "Refused: No user matches 00000000-0000-4000-8000-00000000dead" });
});

test("overrides key on the refusal code: a past trial refuses, the repeat-trial tick lets it through", async () => {
  const u = await makeUser();
  await sql(`insert into licenses (user_id, license_key, expires_at, tier) values ($1, $2, now() - interval '20 days', 'trial')`, [u.id, `BTN-OLD-${seq}`]);
  const basketId = await makeBasket(u.id);
  const s = await act(fields(u.id, basketId, { mode: "check" }));
  assert.equal(s?.kind === "plan" && s.refusals.map((r) => r.code).join(), "repeat_trial");
  const done = await act(fields(u.id, basketId, { allowRepeatTrial: "1" }));
  await lic.settleLicenseBackgroundTasks();
  assert.equal(done?.kind, "done", JSON.stringify(done));
});

test("T7 Resend 422: the result says NOT delivered with the channel and error; steps 3 + 4 still ran", async () => {
  const u = await makeUser();
  const basketId = await makeBasket(u.id);
  emailRefused = true;
  let s: Awaited<ReturnType<typeof act>>;
  try {
    s = await act(fields(u.id, basketId));
  } finally {
    emailRefused = false;
  }
  await lic.settleLicenseBackgroundTasks();
  assert.equal(s?.kind, "done");
  if (s?.kind !== "done") return;
  assert.equal(s.result.keySend.ok, false);
  assert.equal(s.result.keySend.channel, "email");
  assert.match(String(s.result.keySend.error), /validation_error/);
  assert.equal((await sql(`select count(*)::int as n from admin_actions where action_type = 'bundle_activate' and target_user_id = $1`, [u.id])).rows[0].n, 1);
  assert.equal((await sql(`select status from basket_requests where id = $1`, [basketId])).rows[0].status, "handled");
  const html = renderToStaticMarkup(<form.KeySendLine keySend={s.result.keySend} />).replace(/<!-- -->/g, "");
  assert.match(html, /Key NOT delivered \(email: validation_error/);
  assert.doesNotMatch(html, /Key sent by/);
});

test("T8 statement order (Fable C8): two plans that both pass, two executes -- the second throws BundleAlreadyActiveError before any send, admin row or basket write", async () => {
  // PGlite is one session, so FOR UPDATE never blocks here: this pins the ORDER in activateBundle -- the users row
  // `for update` (bundles.ts:386) before the active-bundle check (:388) -- and that executeActivation calls the writer
  // before step 2. Real contention is backed by 0107's bundle_subscriptions_user_active_uidx.
  const u = await makeUser();
  const basketId = await makeBasket(u.id);
  const by = { actor: { id: ADMIN, email: "hfthorizon@keemail.me" }, via: "admin" as const };
  const a = { mode: "activate" as const, user: u.id, bundleKey: "horizon-complete" as const, feedChoice: "ld-base" as const, days: 30, isTrial: true, amountUsd: null, receivedAt: null, basketId, allowRepeatTrial: false, allowInternal: false, execute: true };
  const p1 = await cli.planActivation(a, by);
  const p2 = await cli.planActivation(a, by);
  assert.deepEqual([p1.refusals, p2.refusals], [[], []]);
  await cli.executeActivation(p1);
  await lic.settleLicenseBackgroundTasks();
  const c1 = await counts();
  await assert.rejects(cli.executeActivation(p2), bundles.BundleAlreadyActiveError);
  assert.deepEqual(await counts(), c1, "the second wrote nothing and sent nothing");
  const n = async (q: string) => (await sql(q, [u.id])).rows[0].n;
  assert.equal(await n(`select count(*)::int as n from bundle_subscriptions where user_id = $1`), 1);
  assert.equal(await n(`select count(*)::int as n from licenses where user_id = $1`), 1);
  assert.equal(await n(`select count(*)::int as n from admin_actions where action_type = 'license_key_delivery' and target_user_id = $1`), 1);
  assert.equal(await n(`select count(*)::int as n from admin_actions where action_type = 'bundle_activate' and target_user_id = $1`), 1);
  // And through the action: the re-plan sees the active bundle (and the handled basket) and refuses.
  const s = await act(fields(u.id, basketId));
  assert.equal(s?.kind === "plan" && s.refusals.map((r) => r.code).sort().join(), "active_bundle,basket_not_new,live_licence,repeat_trial");
});

test("activateDisabled: off while pending, before a Check, and while any refusal shows", () => {
  const plan = (refusals: { code: any; text: string }[]) => ({ kind: "plan" as const, check: {} as any, refusals });
  assert.equal(ui.activateDisabled(false, plan([])), false);
  assert.equal(ui.activateDisabled(true, plan([])), true, "pending");
  assert.equal(ui.activateDisabled(false, null), true, "no Check yet");
  assert.equal(ui.activateDisabled(false, { kind: "error", error: "x" }), true);
  assert.equal(ui.activateDisabled(false, plan([{ code: "live_licence", text: "x" }])), true);
  assert.equal(ui.refusalText("x is internal (y). Pass --allow-internal to activate for it"), "x is internal (y)");
});

test("T9 the page: 'Activate bundle…' only on a New request with a bundle line; Activate starts disabled; Paid is disabled; the feed is fixed, not a radio", async () => {
  const u = await makeUser();
  const fresh = await makeBasket(u.id);
  const handled = await makeBasket(u.id);
  await sql(`update basket_requests set status = 'handled', handled_at = now() where id = $1`, [handled]);
  const noBundle = await makeBasket(u.id, [{ kind: "software", key: "horizon", name: "Horizon" }]);
  const { default: Page } = await import("./page");
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) })).replace(/<!-- -->/g, "");
  assert.ok(html.includes(`data-bundle-activate="${fresh}"`));
  assert.ok(!html.includes(`data-bundle-activate="${handled}"`), "not on a handled row");
  assert.ok(!html.includes(`data-bundle-activate="${noBundle}"`), "not without a bundle line");

  const one = renderToStaticMarkup(
    <form.BundleActivateForm requestId={fresh} userId={u.id} bundleKey="horizon-complete" bundleTitle="Horizon Complete" feedChoice="ld-base" feedTitle="London · Base" />
  ).replace(/<!-- -->/g, "");
  const tags = (re: RegExp) => one.match(new RegExp(re.source, "g")) ?? [];
  const activate = tags(/<button[^>]*value="activate"[^>]*>/);
  assert.equal(activate.length, 1);
  assert.match(activate[0], /disabled=""/, "Activate starts disabled");
  assert.doesNotMatch(tags(/<button[^>]*value="check"[^>]*>/)[0] ?? "", /disabled=""/, "Check does not");
  const radios = tags(/<input type="radio"[^>]*>/);
  assert.equal(radios.length, 2, "Trial and Paid only: no feed radio (C7)");
  assert.ok(radios.every((r) => /name="trial"/.test(r) && !/checked/.test(r)), "no default");
  assert.match(radios.find((r) => /value="0"/.test(r))!, /disabled=""/, "Paid disabled");
  assert.match(one, /<input type="hidden" name="feed" value="ld-base"\/>/);
  assert.match(one, /London · Base/);
  assert.doesNotMatch(one, /allowRepeatTrial|allowInternal/, "no override shows before its refusal");
});
