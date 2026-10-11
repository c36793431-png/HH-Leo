/* Run: npx tsx --test --experimental-test-module-mocks src/lib/feed-connections-editor.test.tsx
 *
 * B3-2 editor slice (marcus m64921 order; Fable 0102 PASS m64916 N1/N4 for the editor): the /admin/feed-connections
 * page and the per-client usernames on /admin/users/[id]. The writes themselves are pinned in feed-connections.test.tsx;
 * this file pins what an admin sees and that the page's own prefill saves back unchanged. Fail-first: on 36e4cf9 every
 * test here fails (no page, no forms, no symbolLinesText, no user-page wiring). PGlite with the REAL migration chain
 * (the feed-connections.test.tsx harness), no prod. */
import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const ADMIN = "00000000-0000-4000-8000-00000000f002";
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
/** FOC13 m64634, VERIFIED lines: the B FIX symbol list as an admin would paste it. */
const CME_SYMBOLS = [
  "GC.FUT Gold",
  "ES.FUT E-mini S&P 500",
  "NQ.FUT E-mini Nasdaq-100",
  "YM.FUT E-mini Dow",
  "MGC.FUT Micro Gold",
  "MES.FUT Micro E-mini S&P 500",
  "MNQ.FUT Micro E-mini Nasdaq-100",
  "MYM.FUT Micro E-mini Dow",
  "BTC.FUT Bitcoin",
  "CL.FUT Crude Oil",
  "6B.FUT GBP/USD",
  "6E.FUT EUR/USD",
  "SI.FUT Silver",
].join("\n");

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let lib: typeof import("./feed-connections");
let actions: typeof import("../app/admin/feed-connections/actions");
const session: any = { user: { id: ADMIN, email: "admin@example.invalid", role: "admin", roles: ["admin"] } };
let CME: string;

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}
function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");
/** The value of the named textarea in rendered markup, entities decoded the way a browser posts it back. */
function textareaValue(markup: string, name: string): string {
  const m = new RegExp(`<textarea[^>]*name="${name}"[^>]*>([\\s\\S]*?)</textarea>`).exec(markup);
  assert.ok(m, `no textarea ${name}`);
  return m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/^\n/, "");
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
  mock.module("@/lib/auth", { namedExports: { auth: async () => session } });
  mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
  lib = await import("./feed-connections");
  actions = await import("../app/admin/feed-connections/actions");
  await sql(`insert into users (id, email, role) values ($1, 'admin@example.invalid', 'admin')`, [ADMIN]);
  // The prod CME row is a hand INSERT (no migration carries it); the test seeds the same shape.
  CME = (
    await sql(
      `insert into feed_tiers (region_key, tier_key, name, subtitle, speed_display, description, path_redundancy, support_level, price_cents, provider_user_id)
       values ('cme', 'cme-ctrader-fix', 'CME Futures · cTrader FIX', 'FIX 4.4 (cTrader FIX)', '—', 'CME futures', '—', '—', 5000, $1) returning id`,
      [SEED_PROVIDER]
    )
  ).rows[0].id;
});

test("empty state: no connection rows yet, and the new-connection form offers every tier and every type", async () => {
  const { default: Page } = await import("../app/admin/feed-connections/page");
  const out = html(await Page());
  assert.match(out, /No connections set yet/);
  assert.match(out, new RegExp(`<option value="${CME}"[^>]*>[^<]*cme-ctrader-fix`));
  const ny = (await sql(`select id from feed_tiers where tier_key = 'ny-normal'`)).rows[0].id;
  assert.match(out, new RegExp(`<option value="${ny}"`));
  for (const t of ["ctrader_fix", "b_fix", "horizon_direct"]) assert.match(out, new RegExp(`<option value="${t}"`));
});

test("help text: symbols are 'SYMBOL Description, one per line' (Fable N1); host is a hostname or IPv4, no IPv6 (N4); no password field", async () => {
  const { default: Page } = await import("../app/admin/feed-connections/page");
  const out = html(await Page());
  assert.match(out, /SYMBOL Description, one per line/);
  assert.match(out, /hostname or IPv4/);
  assert.match(out, /no IPv6/);
  assert.match(out, /password is sent to the client separately/i);
  assert.doesNotMatch(out, /type="password"|name="password"/i);
});

test("a set row renders with its tier, type, host:port, data type, hours and every symbol prefilled as SYMBOL Description lines", async () => {
  await actions.setFeedTierConnectionAction(
    null,
    form({ feedTierId: CME, connType: "b_fix", host: "160.187.32.117", port: "5031", dataType: "Top of book (best bid/ask)", sessionHours: "Sun 17:00 – Fri 16:00 CT", symbols: CME_SYMBOLS })
  );
  await actions.setFeedTierConnectionAction(null, form({ feedTierId: CME, connType: "ctrader_fix", host: "160.187.32.117", port: "5101", dataType: "", sessionHours: "", symbols: "" }));
  const { default: Page } = await import("../app/admin/feed-connections/page");
  const out = html(await Page());
  assert.doesNotMatch(out, /No connections set yet/);
  assert.match(out, /CME Futures · cTrader FIX/);
  assert.match(out, /B FIX/);
  assert.match(out, /160\.187\.32\.117:5031/);
  assert.match(out, /160\.187\.32\.117:5101/);
  assert.match(out, /13 symbols/);
  assert.match(out, /0 symbols/);
  assert.match(out, /value="Top of book \(best bid\/ask\)"/);
  assert.equal(textareaValue(out, "symbols"), CME_SYMBOLS, "the first (b_fix) form holds the 13 lines as pasted");
});

test("the page's own prefill saves back unchanged: symbolLinesText round-trips through parseSymbolLines, incl. a dash in the description", async () => {
  const entries = [
    { symbol: "GC.FUT", description: "Gold" },
    { symbol: "ES.FUT", description: "E-mini S&P 500 - front month" },
    { symbol: "6B.FUT", description: "GBP/USD" },
    // Stored via "SI.FUT — - odd": written back bare, the parser would eat the "- " as the separator.
    { symbol: "SI.FUT", description: "- odd" },
  ];
  assert.equal(lib.symbolLinesText(entries), "GC.FUT Gold\nES.FUT E-mini S&P 500 - front month\n6B.FUT GBP/USD\nSI.FUT — - odd");
  assert.deepEqual(lib.parseSymbolLines(lib.symbolLinesText(entries)), entries);
  assert.equal(lib.symbolLinesText([]), "");
  const row = (await lib.listFeedTierConnections()).find((c) => c.connType === "b_fix")!;
  assert.deepEqual(lib.parseSymbolLines(lib.symbolLinesText(row.symbols)), row.symbols);
});

test("each row's form is keyed by updatedAt, so a save remounts it with the saved values (Fable S1: defaultValue is never re-applied to a mounted input)", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/admin/feed-connections/page.tsx"), "utf8");
  assert.ok(/<ConnectionForm\s+key=\{c\.updatedAt\.toISOString\(\)\}\s+row=\{/.test(src), "row form keyed by c.updatedAt");
});

test("/admin/users/[id] lists the client's connection usernames from listClientLoginRows, under the feed assignment", async () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/admin/users/[id]/page.tsx"), "utf8");
  // assert.ok, not assert.match: a failed match would print the whole 700-line page.
  assert.ok(/import \{ ClientLoginRows \} from "@\/components\/admin\/client-login-rows"/.test(src), "imports ClientLoginRows");
  assert.ok(/listClientLoginRows\(id\)/.test(src), "reads listClientLoginRows(id)");
  assert.ok(/<ClientLoginRows userId=\{user\.userId\} rows=\{clientLoginRows\} \/>/.test(src), "renders ClientLoginRows");
  assert.ok(src.indexOf("<ClientLoginRows") > src.indexOf("<FeedTierSelectForm"), "after the feed provider assignment");
  assert.ok(/clientLoginRows\.length > 0 &&/.test(src), "no empty heading for a client with no connection rows");
});

test("sidebar: Feed connections is a feed-admin link next to Feed boxes", () => {
  const src = readFileSync(path.join(process.cwd(), "src/components/portal/sidebar.tsx"), "utf8");
  const feedList = src.slice(src.indexOf("const FEED_ADMIN_LINKS"));
  const boxes = feedList.indexOf('href: "/admin/feed-boxes"');
  const conns = feedList.indexOf('{ href: "/admin/feed-connections", label: "Feed connections"');
  assert.ok(boxes > 0 && conns > boxes, "listed in FEED_ADMIN_LINKS after Feed boxes");
});
