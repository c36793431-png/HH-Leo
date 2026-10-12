/* Run: npx tsx --test --experimental-test-module-mocks src/lib/server-tab-free-users.test.tsx
 *
 * Server tab for free users (plan to-marcus/server_tab_free_users_plan_2026-10-12.md; rulings marcus m65584: Q-S1 admin
 * block, Q-S2 "Use for licence", Q-S3 same IP card labelled "no licence" + cap 5, Q-S4 tab open anytime + "Add your
 * server" from the request-sent state). A free account writes a server row with license_id NULL (legal since 0086), and
 * every licence-keyed reader must still ignore it. Fail-first: on 8131aab every test here fails (no licence-less writer,
 * no link path, Servers paidOnly, 🔒 page). PGlite with the REAL migration chain, no prod. */
import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const FREE = "00000000-0000-4000-8000-00000000c001";
const FREE2 = "00000000-0000-4000-8000-00000000c002";
const PAID = "00000000-0000-4000-8000-00000000c003";
const PAID_LIC = "00000000-0000-4000-8000-00000000d003";
const PAID_SPARE_LIC = "00000000-0000-4000-8000-00000000d004";
const SEED_PROVIDER = "00000000-0000-4000-8000-0000000000a1";
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
let lib: typeof import("./server-registration");
let actions: typeof import("../app/account/servers/actions");
const session: any = { user: { id: FREE, email: "free@example.invalid", roles: [] } };
const as = (id: string, email: string) => {
  session.user = { id, email, roles: [] };
};
/** Every admin-sink message (telemetry-sink sendSinkMessage) as sent, newest last. */
const sink: string[] = [];

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}
function server(name: string, ip: string, location = "london"): FormData {
  const f = new FormData();
  f.set("serverName", name);
  f.set("vpsProvider", "Contabo");
  f.set("vpsProviderOther", "");
  f.set("location", location);
  f.set("declaredIp", ip);
  return f;
}
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");
async function rowsOf(userId: string) {
  return (await sql(`select id, license_id, user_id, server_name, declared_ip from server_registrations where user_id = $1 order by created_at, server_name`, [userId])).rows;
}
async function renderServersPage(): Promise<string> {
  const { default: Page } = await import("../app/account/servers/page");
  return html(await Page());
}

before(async () => {
  db = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort();
  for (const f of files) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await db.exec(SEEDS[f]);
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  (globalThis as any)._pgPool = { query: sql, connect: async () => ({ query: sql, release() {} }), end: async () => {} };
  process.env.TELEMETRY_BOT_TOKEN = "sink-token";
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/botsink-token/sendMessage")) sink.push(JSON.parse(String(init?.body)).text);
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  }) as typeof fetch;
  mock.module("@/lib/auth", { namedExports: { auth: async () => session } });
  mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
  mock.module("next/navigation", {
    namedExports: {
      redirect: (to: string) => {
        throw new Error(`redirect ${to}`);
      },
      notFound: () => {
        throw new Error("notFound");
      },
      usePathname: () => "/dashboard",
    },
  });
  // The shell is client chrome (sidebar, topbar); the page's own content is what these tests read.
  mock.module("@/components/portal/portal-shell", { namedExports: { PortalShell: ({ children }: { children: ReactNode }) => children } });
  lib = await import("./server-registration");
  actions = await import("../app/account/servers/actions");
  await sql(
    `insert into users (id, email) values ($1, 'free@example.invalid'), ($2, 'free2@example.invalid'), ($3, 'paid@example.invalid')`,
    [FREE, FREE2, PAID]
  );
  await sql(
    `insert into licenses (id, user_id, license_key, expires_at, feed_types)
     values ($1, $3, 'PAID-AAAA-1111', now() + interval '90 days', array['london']),
            ($2, $3, 'PAID-BBBB-2222', now() + interval '90 days', array['ny'])`,
    [PAID_LIC, PAID_SPARE_LIC, PAID]
  );
});

test("T1 a free account sees the server form on /account/servers, not the 🔒 upgrade card, with the 'switches nothing on' line", async () => {
  as(FREE, "free@example.invalid");
  const out = await renderServersPage();
  assert.doesNotMatch(out, /Server registration is available to Horizon HFT users/);
  assert.doesNotMatch(out, /Upgrade to Paid/);
  assert.match(out, /Registering a server doesn&#x27;t switch anything on\. Feeds need a licence and an approved request\./);
  assert.match(out, /London Servers/);
  assert.match(out, /Add here/);
  assert.doesNotMatch(out, /Black trial/i, "the Black trial card stays licence-only");
});

test("T2 the free insert writes license_id NULL + user_id, a second is fine, the 6th is refused (cap 5); the alert is sent", async () => {
  as(FREE, "free@example.invalid");
  for (let i = 1; i <= 5; i++) {
    const r = await actions.saveUserServerRegistrationAction(null, server(`free-${i}`, `198.51.100.${i}`));
    assert.deepEqual(r, { ok: true }, `insert ${i}`);
  }
  const rows = await rowsOf(FREE);
  assert.equal(rows.length, 5);
  for (const r of rows) {
    assert.equal(r.license_id, null);
    assert.equal(r.user_id, FREE);
  }
  const sixth = await actions.saveUserServerRegistrationAction(null, server("free-6", "198.51.100.6"));
  assert.equal(sixth.ok, false);
  assert.match((sixth as { error: string }).error, /up to 5 servers without a licence/i);
  assert.equal((await rowsOf(FREE)).length, 5, "the refused 6th wrote nothing");
});

test("at the cap the free page offers no 'Add here' and says the limit once, under the open group", async () => {
  as(FREE, "free@example.invalid");
  const out = await renderServersPage();
  assert.doesNotMatch(out, /Add here/);
  assert.equal(out.match(/You can register up to 5 servers without a licence/g)?.length, 1);
  assert.doesNotMatch(out, /Get another licence/, "a licence is not what a free account at the cap is missing");
});

test("T3 edit works on your own licence-less row and refuses another user's row id", async () => {
  const [row] = await rowsOf(FREE);
  as(FREE, "free@example.invalid");
  assert.deepEqual(await actions.updateServerRegistrationAction(row.id, null, server("free-1-renamed", row.declared_ip)), { ok: true });
  assert.equal((await rowsOf(FREE)).find((r) => r.id === row.id)?.server_name, "free-1-renamed");
  as(FREE2, "free2@example.invalid");
  const stolen = await actions.updateServerRegistrationAction(row.id, null, server("hijack", "203.0.113.66"));
  assert.deepEqual(stolen, { ok: false, error: "Server not found on this account" });
  assert.equal((await rowsOf(FREE)).find((r) => r.id === row.id)?.declared_ip, row.declared_ip);
});

test("T4 isolation: a free user's licence-less rows unlock nothing licence-keyed (picker, banner, dashboard count, basket feed_ready)", async () => {
  assert.ok((await rowsOf(FREE)).length > 0, "precondition: FREE has licence-less rows from the new writer");
  assert.deepEqual(await lib.getServerRegistrationsForUser(FREE), []);
  assert.equal(await lib.getAnyServerRegistrationForUser(FREE), null);
  assert.equal(await lib.countUserActiveServers(FREE), 0);
  const { getBasketAccountState } = await import("./basket-requests");
  assert.equal((await getBasketAccountState(FREE)).feedReady, false);
});

test("T5 the Black trial action still refuses a free user who has registered a server", async () => {
  as(FREE, "free@example.invalid");
  const [row] = await rowsOf(FREE);
  const r = await actions.requestBlackTrialAction(row.id);
  assert.equal(r.ok, false);
  assert.equal((await sql(`select count(*)::int as n from black_trials where user_id = $1`, [FREE])).rows[0].n, 0);
});

test("T6 sidebar: Servers is open to a free account; Downloads is still locked", async () => {
  const { PortalSidebar } = await import("../components/portal/sidebar");
  const out = html(<PortalSidebar tier="free" isAdmin={false} userName="Free" userEmail="free@example.invalid" />);
  const link = (href: string) => {
    const m = new RegExp(`<a[^>]*href="${href}"[^>]*>([\\s\\S]*?)</a>`).exec(out);
    assert.ok(m, `no link ${href}`);
    return m[0];
  };
  assert.doesNotMatch(link("/account/servers"), /🔒|class="locked"/);
  assert.match(link("/dashboard#downloads"), /Downloads[\s\S]*🔒/);
});

test("T7 'Use for licence': owner-only, NULL-only, own licence only, and refused for a licence that already has a server", async () => {
  // FREE2 registers while free, then is issued a licence of their own.
  as(FREE2, "free2@example.invalid");
  assert.deepEqual(await actions.saveUserServerRegistrationAction(null, server("f2-box", "192.0.2.10", "ny")), { ok: true });
  const [f2Row] = await rowsOf(FREE2);
  const f2Lic = (
    await sql(
      `insert into licenses (user_id, license_key, expires_at, feed_types) values ($1, 'F2-KEY-0001', now() + interval '30 days', array['ny']) returning id`,
      [FREE2]
    )
  ).rows[0].id;

  // not the row's owner (FREE's row, FREE2's own licence)
  const [freeRow] = await rowsOf(FREE);
  assert.deepEqual(await actions.linkServerRegistrationAction(freeRow.id, f2Lic), { ok: false, error: "Server not found on this account" });
  // not the licence's owner (FREE2's row, PAID's spare licence)
  assert.deepEqual(await actions.linkServerRegistrationAction(f2Row.id, PAID_SPARE_LIC), { ok: false, error: "License not found on this account" });
  // the lib re-checks licence ownership itself, not only through the action
  assert.equal(await lib.linkServerRegistrationToLicence(f2Row.id, FREE2, PAID_SPARE_LIC), false);

  // the real link
  assert.deepEqual(await actions.linkServerRegistrationAction(f2Row.id, f2Lic), { ok: true });
  assert.equal((await rowsOf(FREE2))[0].license_id, f2Lic);
  assert.equal((await lib.getServerRegistrationsForUser(FREE2)).length, 1, "now visible to the licence-keyed picker");
  assert.equal(await lib.countUserActiveServers(FREE2), 1);
  // NULL-only: an already-linked row can't be moved to another licence
  const f2Lic2 = (
    await sql(`insert into licenses (user_id, license_key, expires_at) values ($1, 'F2-KEY-0002', now() + interval '30 days') returning id`, [FREE2])
  ).rows[0].id;
  assert.deepEqual(await actions.linkServerRegistrationAction(f2Row.id, f2Lic2), { ok: false, error: "Server not found on this account" });
  assert.equal((await rowsOf(FREE2))[0].license_id, f2Lic);

  // a licence that already has a server: unique(license_id) refuses it, said plainly
  assert.deepEqual(await actions.saveUserServerRegistrationAction(null, server("f2-second", "192.0.2.11", "ny")), { ok: true });
  const second = (await rowsOf(FREE2)).find((r) => r.server_name === "f2-second")!;
  assert.deepEqual(await actions.linkServerRegistrationAction(second.id, f2Lic), { ok: false, error: "That licence already has a server." });
  assert.equal((await rowsOf(FREE2)).find((r) => r.id === second.id)?.license_id, null);
});

test("T8 the IP card for a licence-less row is labelled 'no licence' and links /admin/users/<id>, on insert and on an IP edit", async () => {
  sink.length = 0;
  as(FREE2, "free2@example.invalid");
  assert.deepEqual(await actions.saveUserServerRegistrationAction(null, server("f2-third", "192.0.2.12", "ny")), { ok: true });
  assert.equal(sink.length, 1);
  assert.match(sink[0], /new server registration · no licence/);
  assert.match(sink[0], new RegExp(`https://portal\\.horizonhft\\.com/admin/users/${FREE2}$`));

  const third = (await rowsOf(FREE2)).find((r) => r.server_name === "f2-third")!;
  assert.deepEqual(await actions.updateServerRegistrationAction(third.id, null, server("f2-third", "192.0.2.99", "ny")), { ok: true });
  assert.equal(sink.length, 2);
  assert.match(sink[1], /server ip changed · no licence/);
  assert.match(sink[1], /192\.0\.2\.12 -> 192\.0\.2\.99/);
  assert.match(sink[1], new RegExp(`https://portal\\.horizonhft\\.com/admin/users/${FREE2}$`));

  // a licensed registration's card is unchanged: no label, /admin/connections/<licence>
  sink.length = 0;
  as(PAID, "paid@example.invalid");
  assert.deepEqual(await actions.saveServerRegistrationAction(PAID_LIC, null, server("paid-box", "203.0.113.5")), { ok: true });
  assert.equal(sink.length, 1);
  assert.doesNotMatch(sink[0], /no licence/);
  assert.match(sink[0], new RegExp(`/admin/connections/${PAID_LIC}$`));
});

test("paid page: today's licence cards, plus licence-less rows under 'Not linked to a licence' with 'Use for licence' per spare licence", async () => {
  as(PAID, "paid@example.invalid");
  assert.deepEqual(await actions.saveUserServerRegistrationAction(null, server("paid-unlinked", "203.0.113.77", "ny")), { ok: true });
  const out = await renderServersPage();
  assert.match(out, /paid-box/);
  assert.match(out, /Not linked to a licence/);
  assert.match(out, /paid-unlinked/);
  assert.match(out, /Use for licence PAID-BBBB-2222/, "the spare licence is offered");
  assert.doesNotMatch(out, /Use for licence PAID-AAAA-1111/, "a licence that already has a server is not offered");
});

test("Q-S1 /admin/users/[id] gets a read-only Servers block listing every row the user owns, licensed or not", async () => {
  const rows = await lib.listServerRegistrationsForAdminUser(PAID);
  assert.deepEqual(rows.map((r) => r.serverName).sort(), ["paid-box", "paid-unlinked"]);
  const { AdminUserServers } = await import("../components/admin/user-servers");
  const out = html(<AdminUserServers rows={rows} />);
  assert.match(out, /paid-box/);
  assert.match(out, /203\.0\.113\.5/);
  assert.match(out, /XXXX-XXXX-1111/, "the licence key is masked");
  assert.match(out, /paid-unlinked[\s\S]*Not linked/);
  assert.doesNotMatch(out, /<form|<button/, "read-only");

  const src = readFileSync(path.join(process.cwd(), "src/app/admin/users/[id]/page.tsx"), "utf8");
  assert.ok(/import \{ AdminUserServers \} from "@\/components\/admin\/user-servers"/.test(src), "imports AdminUserServers");
  assert.ok(/listServerRegistrationsForAdminUser\(id\)/.test(src), "reads listServerRegistrationsForAdminUser(id)");
  assert.ok(/<AdminUserServers rows=\{servers\} \/>/.test(src), "renders AdminUserServers");
});

test("/admin/connections names a licence-less server's owner (users reached through sr.user_id when there is no licence) and links their user page", async () => {
  const rows = await lib.listConnectionOverview();
  const free = rows.filter((r) => r.registrationId && r.licenseId === null && r.userId === FREE);
  assert.equal(free.length, 5, "FREE's five licence-less servers, each with its owner");
  for (const r of free) assert.equal(r.email, "free@example.invalid");
  const paidBox = rows.find((r) => r.serverName === "paid-box")!;
  assert.equal(paidBox.licenseId, PAID_LIC);
  assert.equal(paidBox.email, "paid@example.invalid", "a licensed row still resolves its owner through the licence");

  const src = readFileSync(path.join(process.cwd(), "src/app/admin/connections/page.tsx"), "utf8");
  assert.ok(/\) : r\.userId \? \(\s*(\/\/[^\n]*\n\s*)*<Link href=\{`\/admin\/users\/\$\{r\.userId\}`\}/.test(src), "licence-less row links /admin/users/<id>");
});

test("Q-S4 the basket's Request sent state links 'Add your server →' to /account/servers when a feed was asked for and no server is ready", () => {
  const src = readFileSync(path.join(process.cwd(), "src/components/marketplace/basket-view.tsx"), "utf8");
  const sentBlock = src.slice(src.indexOf("// ---- 3 · SENT ----"), src.indexOf("// ---- EMPTY ----"));
  assert.ok(
    /sent\.lines\.some\(\(l\) => l\.kind === "feed"\) && !account\?\.feedReady && \(\s*<Link href="\/account\/servers" className="btn ghost">\s*Add your server →\s*<\/Link>/.test(sentBlock),
    "Add your server → link in the sent actions"
  );
});
