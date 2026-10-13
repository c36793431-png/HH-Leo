/* Run: npx tsx --test --experimental-test-module-mocks src/lib/downloads-draft.test.ts
 *
 * Agent release upload (plan m66654 + m66679, Fable PASS WITH STRIKES m66680, marcus GO m66684):
 *  - 0106: backfill, re-run safety, the mapping hash check, and a rollback that refuses while a draft exists;
 *  - the token is draft-only: confirm always records published_at NULL, whatever the body says;
 *  - S1: a taken version refuses with no Blob call at all; a pathname a live or draft row points at
 *    refuses with no Blob call; cleanup never deletes a pathname a row points at (a deleted row's
 *    kept map included), also when a concurrent confirm wins the insert;
 *  - S2: version / filename / sha256 shapes on phase 1, confirm and finalize; both pathnames are
 *    computed by the server, keyed by the zip sha, minted with no random suffix and no overwrite;
 *    the map is required, re-hashed, and stored as mapping_sha256 / mapping_size_bytes;
 *  - readers: a draft is invisible to latest, /api/download/<version> and the file route (except
 *    for an admin), visible in the admin list; latest orders by published_at; no reader SELECT
 *    names a mapping_* column;
 *  - publish / unpublish are admin-session actions with published_by, admin_actions rows and the
 *    three revalidates; confirm revalidates /admin/downloads only.
 * The REAL routes, lib and server actions on PGlite 0.4.6 with the real migration chain; Blob,
 * auth() and next/cache are mocked. */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const SEED_PROVIDER = "00000000-0000-4000-8000-0000000000a1";
const ADMIN = "00000000-0000-4000-8000-00000000d002";
const PRE_UPLOADER = "00000000-0000-4000-8000-00000000d106";
const PAID = "00000000-0000-4000-8000-00000000d107";
const SEVEN_PAIRS = [
  ["9239faa5-88a0-4789-9774-b0c161823b29", "c0e8b76c-3b3d-433d-a47c-b7ba4f87c45b"],
  ["a66d928c-6830-4cb3-80af-06cfca4ad3b6", "6c3f0587-b3b3-4a58-909f-05c507d975e9"],
  ["5182a8be-96ab-4ad7-8b3c-ff2603e8f784", "973abad0-bc81-4c8e-87cf-9a30c1287385"],
  ["a830b5f8-a358-4203-971d-281fd65784b9", "176ca960-de6a-4dac-b17b-693448a526ad"],
  ["122221aa-789d-4830-8726-2060147d9206", "5b50698e-98f1-4ca3-b607-e91ae2183028"],
  ["ce3d2cce-28dc-4e4c-bb8e-889c9a6a29db", "692523d5-207d-4ad5-8310-2702035d29c2"],
  ["5e3fa8fd-ebac-4516-a68a-9d8101644786", "6865647f-735f-4db6-b3da-5f233e341aa0"],
];
const MIGRATION_0106 = "0106_downloads_draft_publish.sql";
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
  // Rows that exist when 0106 is applied: one live, one soft-deleted (both went live at insert).
  [MIGRATION_0106]: `
    insert into users (id, email) values ('${PRE_UPLOADER}', 'pre-uploader@example.invalid');
    insert into downloads (version, platform, blob_url, blob_pathname, sha256, size_bytes, uploaded_by, uploaded_at)
      values ('1.9.0', 'windows', 'https://store.test/pre', 'downloads/windows/1.9.0/pre-a.zip', repeat('a', 64), 10,
              '${PRE_UPLOADER}', '2026-09-01T00:00:00Z');
    insert into downloads (version, platform, blob_url, blob_pathname, sha256, size_bytes, uploaded_by, uploaded_at, deleted_at)
      values ('1.8.0', 'windows', 'https://store.test/old', 'downloads/windows/1.8.0/old-a.zip', repeat('b', 64), 10,
              '${PRE_UPLOADER}', '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z');`,
};
const SKIPPED = new Set(["0082_provider_client_pseudonyms_backfill.sql"]);
const TOKEN = "publish-test-token-0123456789abcdefghijklmnopqrstuvwxyz0123456789";
const ENV = {
  NEON_DATABASE_URL: "postgres://unused",
  PUBLISH_API_TOKEN: TOKEN,
  INSTALLER_URL_SECRET: "installer-secret",
  HORIZON_PORTAL_BOT_TOKEN: "portal-token",
  TELEMETRY_BOT_TOKEN: "telemetry-token",
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let dl: typeof import("./downloads");
let pb: typeof import("./publish-builds");
let actions: typeof import("../app/admin/downloads/actions");
let phase1: typeof import("../app/api/admin/publish-build/route");
let confirmRoute: typeof import("../app/api/admin/publish-build/confirm/route");
let finalizeRoute: typeof import("../app/api/admin/downloads/finalize/route");
let versionRoute: typeof import("../app/api/download/[version]/route");
let fileRoute: typeof import("../app/api/download/file/route");
let tokens: typeof import("./download-token");

const statements: string[] = [];
/** When set, runs once just before confirm's insert (a concurrent confirm winning the race). */
let beforeInsert: (() => Promise<void>) | null = null;
async function sql(text: string, params: unknown[] = []) {
  statements.push(text);
  if (beforeInsert && /^\s*insert into downloads/.test(text)) {
    const run = beforeInsert;
    beforeInsert = null;
    await run();
  }
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}

// Fake Blob store: pathname -> bytes, plus a log of every get/del.
const store = new Map<string, Buffer>();
const blobCalls: string[] = [];
const minted: any[] = [];
const revalidated: string[] = [];
let session: any = null;

before(async () => {
  db = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort();
  for (const f of files) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await db.exec(SEEDS[f]);
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  (globalThis as any)._pgPool = { query: sql, connect: async () => ({ query: sql, release() {} }), end: async () => {} };
  Object.assign(process.env, ENV);
  // The lib loads as CJS here, so the package's require entry (index.cjs) is mocked as well as its
  // import entry.
  const blobMock = {
    namedExports: {
      get: async (p: string) => {
        blobCalls.push(`get ${p}`);
        const bytes = store.get(p);
        if (!bytes) return null;
        return { statusCode: 200, stream: new Blob([new Uint8Array(bytes)]).stream(), headers: new Headers(), blob: { url: `https://store.test/${p}`, pathname: p } };
      },
      del: async (p: string) => {
        blobCalls.push(`del ${p}`);
        store.delete(p);
      },
      put: async () => {
        throw new Error("unexpected server put");
      },
    },
  };
  const clientMock = {
    namedExports: {
      generateClientTokenFromReadWriteToken: async (o: any) => {
        minted.push(o);
        return `client-token:${o.pathname}`;
      },
    },
  };
  const requireFromRoot = createRequire(path.join(process.cwd(), "package.json"));
  mock.module("@vercel/blob", blobMock);
  mock.module(pathToFileURL(requireFromRoot.resolve("@vercel/blob")).href, blobMock);
  mock.module("@vercel/blob/client", clientMock);
  mock.module(pathToFileURL(requireFromRoot.resolve("@vercel/blob/client")).href, clientMock);
  mock.module("@/lib/auth", { namedExports: { auth: async () => session } });
  mock.module("next/cache", { namedExports: { revalidatePath: (p: string) => revalidated.push(p) } });
  dl = await import("./downloads");
  pb = await import("./publish-builds");
  actions = await import("../app/admin/downloads/actions");
  phase1 = await import("../app/api/admin/publish-build/route");
  confirmRoute = await import("../app/api/admin/publish-build/confirm/route");
  finalizeRoute = await import("../app/api/admin/downloads/finalize/route");
  versionRoute = await import("../app/api/download/[version]/route");
  fileRoute = await import("../app/api/download/file/route");
  tokens = await import("./download-token");
  await sql(`insert into users (id, email, role) values ($1, 'hfthorizon@keemail.me', 'admin')`, [ADMIN]);
  await sql(`insert into users (id, email) values ($1, 'paid@example.invalid')`, [PAID]);
  await sql(
    `insert into licenses (user_id, license_key, expires_at, feed_types) values ($1, 'PAID-1', now() + interval '30 days', array['london'])`,
    [PAID]
  );
});

beforeEach(() => {
  statements.length = 0;
  blobCalls.length = 0;
  minted.length = 0;
  revalidated.length = 0;
  beforeInsert = null;
  session = null;
});

const ADMIN_SESSION = { user: { id: ADMIN, email: "hfthorizon@keemail.me", role: "admin", roles: ["admin"] } };
const PAID_SESSION = { user: { id: PAID, email: "paid@example.invalid", role: "user", roles: ["user"] } };

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
let seq = 0;
/** A build + map the uploader has PUT (or not) at the server-computed pathnames. */
function build(version: string, opts: { store?: boolean; storeMap?: boolean; platform?: "windows" | "macos" } = {}) {
  seq++;
  const platform = opts.platform ?? "windows";
  const zip = Buffer.from(`zip bytes ${version} ${seq}`);
  const map = Buffer.from(`Mapping.txt for ${version} ${seq}`);
  const paths = pb.publishPathnames(platform, version, sha(zip), "horizon-hft-client.zip");
  if (opts.store !== false) store.set(paths.build, zip);
  if (opts.store !== false && opts.storeMap !== false) store.set(paths.mapping, map);
  return {
    zip,
    map,
    paths,
    args: {
      version,
      platform,
      filename: "horizon-hft-client.zip",
      declaredSha256: sha(zip),
      declaredSizeBytes: zip.byteLength,
      declaredMappingSha256: sha(map),
      declaredMappingSizeBytes: map.byteLength,
      uploadedBy: ADMIN,
    },
    body: {
      version,
      platform,
      sha256: sha(zip),
      sizeBytes: zip.byteLength,
      mappingSha256: sha(map),
      mappingSizeBytes: map.byteLength,
    },
  };
}

function req(url: string, body: unknown, auth: string | null = `Bearer ${TOKEN}`) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth !== null) headers.authorization = auth;
  return new NextRequest(`https://portal.test${url}`, { method: "POST", headers, body: JSON.stringify(body) });
}

async function row(id: string) {
  return (await sql(`select * from downloads where id = $1`, [id])).rows[0];
}

async function refusedWith(p: Promise<unknown>, status: number, text: RegExp) {
  await assert.rejects(p, (err: any) => {
    assert.ok(err instanceof pb.PublishRefusedError, `a PublishRefusedError, got ${err}`);
    assert.equal(err.status, status);
    assert.match(err.message, text);
    return true;
  });
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

// ---------- 0106 ----------

test("0106 backfills every pre-existing row as published at its upload time, by its uploader", async () => {
  const rows = (await sql(`select version, uploaded_at, published_at, published_by from downloads where version in ('1.9.0', '1.8.0') order by version`)).rows;
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.deepEqual(r.published_at, r.uploaded_at, `${r.version} published_at = uploaded_at`);
    assert.equal(r.published_by, PRE_UPLOADER);
  }
  const latest = await dl.getLatestDownloads();
  assert.equal(latest.windows?.version, "1.9.0", "the pre-existing live row is still the latest after 0106");
});

test("re-running 0106 never publishes a draft", async () => {
  const b = build("3.0.1");
  const d = await pb.confirmPublishedBuild(b.args);
  await db.exec(readFileSync(path.join(MIGRATIONS, MIGRATION_0106), "utf8"));
  assert.equal((await row(d.id)).published_at, null);
});

test("0106: mapping_sha256 must be lowercase hex", async () => {
  await assert.rejects(
    sql(`insert into downloads (version, platform, blob_url, blob_pathname, sha256, size_bytes, mapping_sha256)
         values ('3.0.2', 'macos', 'u', 'p', repeat('c', 64), 1, repeat('C', 64))`),
    /downloads_mapping_sha256_hex/
  );
});

// ---------- the token is draft-only ----------

test("confirm records a DRAFT: published_at and published_by NULL, source ci, server-computed hashes, sizes and URLs", async () => {
  const b = build("3.1.0");
  const d = await pb.confirmPublishedBuild(b.args);
  const r = await row(d.id);
  assert.equal(r.published_at, null);
  assert.equal(r.published_by, null);
  assert.equal(r.source, "ci");
  assert.equal(r.blob_pathname, b.paths.build);
  assert.equal(r.blob_url, `https://store.test/${b.paths.build}`);
  assert.equal(r.sha256, sha(b.zip));
  assert.equal(Number(r.size_bytes), b.zip.byteLength);
  assert.equal(r.mapping_blob_pathname, b.paths.mapping);
  assert.equal(r.mapping_blob_url, `https://store.test/${b.paths.mapping}`);
  assert.equal(r.mapping_sha256, sha(b.map));
  assert.equal(Number(r.mapping_size_bytes), b.map.byteLength);
  assert.ok(!blobCalls.some((c) => c.startsWith("del")), "a good upload deletes nothing");
  const insert = statements.find((s) => /insert into downloads/.test(s))!;
  assert.match(insert, /'ci', null, null\)/, "published_at, published_by are literal NULLs in the SQL");
});

test("the confirm route can't publish: published_at / publishedAt / published in the body change nothing", async () => {
  const b = build("3.1.1");
  const res = await confirmRoute.POST(req("/api/admin/publish-build/confirm", { ...b.body, published_at: "2026-01-01", publishedAt: "2026-01-01", published: true }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.draft, true);
  assert.equal((await row(json.id)).published_at, null);
  assert.deepEqual(revalidated, ["/admin/downloads"], "a draft revalidates the admin list only");
  const audit = (await sql(`select details_json from admin_actions where action_type = 'publish_build_ci' order by created_at desc limit 1`)).rows[0];
  assert.equal(audit.details_json.draft, true);
});

test("bearer: missing, wrong, or a same-length wrong token is 401 with nothing minted; the compare is constant-time", async () => {
  const body = { version: "3.2.0", platform: "windows", sha256: "a".repeat(64), size: 1 };
  const wrongSameLength = `Bearer ${"x".repeat(TOKEN.length)}`;
  for (const auth of [null, "Bearer nope", wrongSameLength, TOKEN]) {
    assert.equal((await phase1.POST(req("/api/admin/publish-build", body, auth))).status, 401, `${auth?.slice(0, 10)}`);
    assert.equal((await confirmRoute.POST(req("/api/admin/publish-build/confirm", {}, auth))).status, 401);
  }
  assert.equal(minted.length, 0);
  for (const f of ["src/app/api/admin/publish-build/route.ts", "src/app/api/admin/publish-build/confirm/route.ts"]) {
    const src = readFileSync(path.join(process.cwd(), f), "utf8");
    assert.doesNotMatch(src, /===\s*`Bearer/, `${f}: no plain === on the bearer`);
    assert.match(src, /isPublishBearer\(/);
  }
  assert.match(readFileSync(path.join(process.cwd(), "src/lib/publish-builds.ts"), "utf8"), /timingSafeEqual/);
  const saved = process.env.PUBLISH_API_TOKEN;
  delete process.env.PUBLISH_API_TOKEN;
  assert.equal(pb.isPublishBearer(`Bearer ${saved}`), false, "unset token = every call refused");
  process.env.PUBLISH_API_TOKEN = saved;
  assert.equal(pb.isPublishBearer(`Bearer ${saved}`), true);
});

test("no route or script holds a publish path for the token: publish is only an admin server action", async () => {
  const script = readFileSync(path.join(process.cwd(), "scripts/upload-release.mjs"), "utf8");
  assert.doesNotMatch(script, /publishDownload|published_at|publishedAt/);
  const routes = ["src/app/api/admin/publish-build/route.ts", "src/app/api/admin/publish-build/confirm/route.ts"]
    .map((f) => readFileSync(path.join(process.cwd(), f), "utf8"))
    .join("\n");
  assert.doesNotMatch(routes, /publishDownload\b|published_at\s*=/);
});

// ---------- S2: shapes and pathnames ----------

test("phase 1: version, filename, sha256 and size shapes are enforced, and a refusal mints nothing", async () => {
  const ok = { version: "3.3.0", platform: "windows", sha256: "a".repeat(64), size: 5 };
  const bad: [string, Record<string, unknown>][] = [
    ["one-part version", { version: "3" }],
    ["five-part version", { version: "3.3.0.1.2" }],
    ["version with a slash", { version: "3.3/../2.0.8" }],
    ["version with a letter", { version: "3.3.0b" }],
    ["filename with /", { filename: "a/b.zip" }],
    ["filename with \\", { filename: "a\\b.zip" }],
    ["filename with ..", { filename: "a..zip" }],
    ["filename not .zip", { filename: "setup.exe" }],
    ["empty filename", { filename: "" }],
    ["uppercase sha", { sha256: "A".repeat(64) }],
    ["63-char sha", { sha256: "a".repeat(63) }],
    ["non-hex sha", { sha256: "g".repeat(64) }],
    ["fractional size", { size: 1.5 }],
    ["zero size", { size: 0 }],
  ];
  for (const [label, patch] of bad) {
    const res = await phase1.POST(req("/api/admin/publish-build", { ...ok, ...patch }));
    assert.equal(res.status, 400, label);
  }
  assert.equal(minted.length, 0, "nothing minted for a bad shape");
  assert.equal((await phase1.POST(req("/api/admin/publish-build", { ...ok, version: "2.0.5.2" }))).status, 200, "four parts ok");
});

test("phase 1 mints both tokens at the sha-keyed pathnames, no random suffix, no overwrite", async () => {
  const s = "d".repeat(64);
  const res = await phase1.POST(req("/api/admin/publish-build", { version: "3.3.1", platform: "macos", sha256: s, size: 9, filename: "Horizon-3.3.1.zip" }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.buildUpload.pathname, `downloads/macos/3.3.1/${s}/Horizon-3.3.1.zip`);
  assert.equal(json.mappingUpload.pathname, `mappings/macos/3.3.1/${s}/Mapping.txt`);
  assert.equal(minted.length, 2);
  for (const m of minted) {
    assert.equal(m.addRandomSuffix, false);
    assert.equal(m.allowOverwrite, false);
  }
  assert.deepEqual(minted.map((m) => m.pathname).sort(), [json.buildUpload.pathname, json.mappingUpload.pathname].sort());
});

test("confirm route: the same shapes are enforced, and a mapping hash/size is required", async () => {
  const b = build("3.3.2");
  for (const patch of [
    { version: "3.3/2" },
    { filename: "../x.zip" },
    { sha256: b.body.sha256.toUpperCase() },
    { mappingSha256: undefined },
    { mappingSha256: "A".repeat(64) },
    { mappingSizeBytes: 0 },
  ]) {
    const res = await confirmRoute.POST(req("/api/admin/publish-build/confirm", { ...b.body, ...patch }));
    assert.equal(res.status, 400, JSON.stringify(patch));
  }
  assert.equal(blobCalls.length, 0);
});

test("finalize (manual admin path) refuses a non-lowercase-hex sha256", async () => {
  session = ADMIN_SESSION;
  const res = await finalizeRoute.POST(
    new NextRequest("https://portal.test/api/admin/downloads/finalize", {
      method: "POST",
      body: JSON.stringify({ blobUrl: "u", blobPathname: "downloads/windows/3.3.3/x.zip", version: "3.3.3", platform: "windows", sha256: "F".repeat(64), sizeBytes: 3 }),
    })
  );
  assert.equal(res.status, 400);
});

// ---------- S1 ----------

test("S1 (i): confirm for a version that has a row (draft or live) refuses 409 before any Blob call", async () => {
  const live = build("3.4.0");
  const d = await pb.confirmPublishedBuild(live.args);
  await dl.publishDownload(d.id, ADMIN);
  blobCalls.length = 0;
  // Fable's kill sequence: the live build's own sha, size and pathname.
  await refusedWith(pb.confirmPublishedBuild(live.args), 409, /already exists \(draft or published\)/);
  assert.deepEqual(blobCalls, [], "no get, no del");
  assert.ok(store.has(live.paths.build), "the live zip is still there");
  assert.ok(store.has(live.paths.mapping), "the live map is still there");

  const draft = build("3.4.1");
  await pb.confirmPublishedBuild(draft.args);
  blobCalls.length = 0;
  const res = await phase1.POST(req("/api/admin/publish-build", { version: "3.4.1", platform: "windows", sha256: draft.body.sha256, size: 1 }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /already exists \(draft or published\)/);
  await refusedWith(pb.confirmPublishedBuild(build("3.4.1").args), 409, /already exists/);
  assert.deepEqual(blobCalls, []);
  assert.equal(minted.length, 0);
});

test("S1 (ii): a pathname a live or draft row points at refuses 422 before any Blob call", async () => {
  // A row whose version was edited after upload still points at the old version's pathnames.
  const b = build("3.5.0");
  const d = await pb.confirmPublishedBuild(b.args);
  await dl.updateDownloadMetadata(d.id, { version: "3.5.0-renamed" });
  blobCalls.length = 0;
  await refusedWith(pb.confirmPublishedBuild(b.args), 422, /belongs to a live or draft release/);
  assert.deepEqual(blobCalls, [], "no get, no del");
  assert.ok(store.has(b.paths.build) && store.has(b.paths.mapping));
});

test("a zip that doesn't match the declared sha/size is refused; this upload's own blobs are deleted; no row", async () => {
  const b = build("3.6.0");
  await refusedWith(pb.confirmPublishedBuild({ ...b.args, declaredSizeBytes: b.args.declaredSizeBytes + 1 }), 422, /does not match/);
  assert.ok(!store.has(b.paths.build) && !store.has(b.paths.mapping));
  assert.equal((await sql(`select 1 from downloads where version = '3.6.0'`)).rowCount, 0);

  const c = build("3.6.1");
  store.set(c.paths.build, Buffer.from("other bytes"));
  await refusedWith(pb.confirmPublishedBuild(c.args), 422, /does not match/);
  assert.equal((await sql(`select 1 from downloads where version = '3.6.1'`)).rowCount, 0);
});

test("Mapping.txt is required: missing = refused (and the zip is cleaned up); a map that differs from the declared hash = refused", async () => {
  const b = build("3.7.0", { storeMap: false });
  await refusedWith(pb.confirmPublishedBuild(b.args), 422, /no uploaded Mapping\.txt/);
  assert.ok(blobCalls.includes(`get ${b.paths.mapping}`), "the map was looked up privately");
  assert.ok(!store.has(b.paths.build), "the orphan zip was deleted");

  const c = build("3.7.1");
  store.set(c.paths.mapping, Buffer.from("a different map"));
  await refusedWith(pb.confirmPublishedBuild(c.args), 422, /Mapping\.txt does not match/);
  assert.equal((await sql(`select 1 from downloads where version in ('3.7.0', '3.7.1')`)).rowCount, 0);

  const nothing = build("3.7.2", { store: false });
  await refusedWith(pb.confirmPublishedBuild(nothing.args), 422, /no uploaded build/);
});

test("cleanup never deletes a deleted row's kept map, and the identical build can be re-uploaded after Delete", async () => {
  const b = build("3.8.0");
  const d = await pb.confirmPublishedBuild(b.args);
  await dl.softDeleteDownload(d.id);
  assert.ok(!store.has(b.paths.build), "Delete removed the zip");
  assert.ok(store.has(b.paths.mapping), "Delete kept the map");

  // Same version and sha, but the zip that lands is wrong: the refusal must not take the kept map.
  store.set(b.paths.build, Buffer.from("corrupt"));
  await refusedWith(pb.confirmPublishedBuild(b.args), 422, /does not match/);
  assert.ok(!store.has(b.paths.build), "the bad zip went");
  assert.ok(store.has(b.paths.mapping), "the kept map stayed");

  // The identical build again: its map PUT would fail (no overwrite), and confirm re-checks the kept one.
  store.set(b.paths.build, b.zip);
  const again = await pb.confirmPublishedBuild(b.args);
  assert.equal((await row(again.id)).mapping_blob_pathname, b.paths.mapping);
  assert.equal((await row(again.id)).published_at, null);
});

test("a concurrent confirm that wins the insert keeps its blobs: the loser gets 409 and deletes nothing", async () => {
  const b = build("3.9.0");
  let winner = "";
  beforeInsert = async () => {
    const r = await db.query(
      `insert into downloads (version, platform, blob_url, blob_pathname, sha256, size_bytes, mapping_blob_pathname, source)
       values ('3.9.0', 'windows', 'u', $1, $2, $3, $4, 'ci') returning id`,
      [b.paths.build, b.args.declaredSha256, b.args.declaredSizeBytes, b.paths.mapping]
    );
    winner = r.rows[0].id;
  };
  await refusedWith(pb.confirmPublishedBuild(b.args), 409, /already exists/);
  assert.ok(winner);
  assert.ok(!blobCalls.some((c) => c.startsWith("del")), "nothing deleted");
  assert.ok(store.has(b.paths.build) && store.has(b.paths.mapping));
});

// ---------- readers ----------

test("a draft is invisible to every customer reader and visible in the admin list", async () => {
  const b = build("4.0.0", { platform: "macos" });
  const d = await pb.confirmPublishedBuild(b.args);
  assert.equal((await dl.getLatestDownloads()).macos, undefined);
  assert.equal(await dl.getDownloadByVersionPlatform("4.0.0", "macos"), null);
  assert.equal(await dl.getDownloadById(d.id), null);
  assert.equal((await dl.getDownloadById(d.id, { includeDrafts: true }))?.id, d.id);
  const listed = (await dl.listDownloads()).find((x) => x.id === d.id);
  assert.ok(listed, "listed for the admin");
  assert.equal(listed!.publishedAt, null);

  // The routes: a paid customer can't reach it by version or by id; an admin can download it.
  session = PAID_SESSION;
  const byVersion = await versionRoute.GET(new NextRequest("https://portal.test/api/download/4.0.0?platform=macos"), { params: Promise.resolve({ version: "4.0.0" }) });
  assert.equal(byVersion.status, 404);
  const paidLink = tokens.signDownloadToken(PAID, d.id);
  const paidFile = await fileRoute.GET(new NextRequest(`https://portal.test/api/download/file?id=${d.id}&expires=${paidLink.expires}&token=${paidLink.token}`));
  assert.equal(paidFile.status, 404, "a signed link for a draft id doesn't serve a customer");
  session = ADMIN_SESSION;
  const adminLink = tokens.signDownloadToken(ADMIN, d.id);
  const adminFile = await fileRoute.GET(new NextRequest(`https://portal.test/api/download/file?id=${d.id}&expires=${adminLink.expires}&token=${adminLink.token}`));
  assert.equal(adminFile.status, 200, "the admin Preview link downloads the draft");
  assert.deepEqual(Buffer.from(await adminFile.arrayBuffer()), b.zip);

  // Published: the customer reaches it.
  await dl.publishDownload(d.id, ADMIN);
  session = PAID_SESSION;
  const after = await versionRoute.GET(new NextRequest("https://portal.test/api/download/4.0.0?platform=macos"), { params: Promise.resolve({ version: "4.0.0" }) });
  assert.equal(after.status, 302);
});

test("latest orders by published_at: an earlier-uploaded draft published later wins; unpublish hands latest back", async () => {
  const early = build("4.1.0");
  const draft = await pb.confirmPublishedBuild(early.args);
  const manual = await dl.finalizeDownloadUpload({
    blobUrl: "u", blobPathname: "downloads/windows/4.1.1/m.zip", version: "4.1.1", platform: "windows",
    sha256: "e".repeat(64), sizeBytes: 4, uploadedBy: ADMIN,
  });
  // The draft was uploaded first; the manual build after it, and published at once.
  await sql(`update downloads set uploaded_at = '2026-01-01' where id = $1`, [draft.id]);
  await sql(`update downloads set uploaded_at = '2026-01-02', published_at = '2026-01-02' where id = $1`, [manual.id]);
  await sql(`update downloads set published_at = '2025-01-01' where published_at is not null and platform = 'windows' and id <> $1`, [manual.id]);
  assert.equal((await dl.getLatestDownloads()).windows?.version, "4.1.1");
  await dl.publishDownload(draft.id, ADMIN);
  assert.equal((await dl.getLatestDownloads()).windows?.version, "4.1.0", "published later = latest, though uploaded earlier");
  await dl.unpublishDownload(draft.id);
  assert.equal((await dl.getLatestDownloads()).windows?.version, "4.1.1", "unpublish: the previous one is latest again");
});

test("reader SELECTs never name a mapping_* column", async () => {
  assert.doesNotMatch(dl.DOWNLOAD_COLUMNS, /mapping/);
  const any = (await dl.listDownloads())[0];
  statements.length = 0;
  await dl.getLatestDownloads();
  await dl.getDownloadByVersionPlatform(any.version, any.platform);
  await dl.getDownloadById(any.id);
  await dl.getDownloadById(any.id, { includeDrafts: true });
  await dl.listDownloads();
  assert.equal(statements.length, 5);
  for (const s of statements) assert.doesNotMatch(s, /mapping/, s);
});

// ---------- publish / unpublish ----------

test("publish and unpublish: admin session only, published_by, audit rows, three revalidates, blob kept", async () => {
  const b = build("4.2.0");
  const d = await pb.confirmPublishedBuild(b.args);

  session = PAID_SESSION;
  const forbidden = await actions.publishDownloadAction(null, form({ id: d.id }));
  assert.equal(forbidden.ok, false);
  assert.equal((await row(d.id)).published_at, null, "a non-admin can't publish");

  session = ADMIN_SESSION;
  revalidated.length = 0;
  const pub = await actions.publishDownloadAction(null, form({ id: d.id }));
  assert.equal(pub.ok, true, JSON.stringify(pub));
  const r = await row(d.id);
  assert.ok(r.published_at);
  assert.equal(r.published_by, ADMIN);
  assert.deepEqual(revalidated.sort(), ["/admin/downloads", "/dashboard", "/downloads"]);
  const pubAudit = (await sql(`select admin_user_id, details_json from admin_actions where action_type = 'publish_download' order by created_at desc limit 1`)).rows[0];
  assert.equal(pubAudit.admin_user_id, ADMIN);
  assert.deepEqual(pubAudit.details_json, { downloadId: d.id, version: "4.2.0", platform: "windows", sha256: sha(b.zip) });

  assert.equal((await actions.publishDownloadAction(null, form({ id: d.id }))).ok, false, "publishing twice is refused");

  blobCalls.length = 0;
  revalidated.length = 0;
  const unpub = await actions.unpublishDownloadAction(null, form({ id: d.id }));
  assert.equal(unpub.ok, true, JSON.stringify(unpub));
  const u = await row(d.id);
  assert.equal(u.published_at, null);
  assert.equal(u.published_by, null);
  assert.equal(u.deleted_at, null);
  assert.deepEqual(blobCalls, [], "unpublish keeps the blob");
  assert.deepEqual(revalidated.sort(), ["/admin/downloads", "/dashboard", "/downloads"]);
  assert.equal((await sql(`select 1 from admin_actions where action_type = 'unpublish_download' and details_json->>'downloadId' = $1`, [d.id])).rowCount, 1);
  assert.equal((await actions.unpublishDownloadAction(null, form({ id: d.id }))).ok, false, "unpublishing a draft is refused");
});

test("the manual admin upload is live at insert, published by the uploader (coxwell's flow unchanged)", async () => {
  const m = await dl.finalizeDownloadUpload({
    blobUrl: "u", blobPathname: "downloads/macos/4.3.0/m.zip", version: "4.3.0", platform: "macos",
    sha256: "f".repeat(64), sizeBytes: 4, uploadedBy: ADMIN,
  });
  const r = await row(m.id);
  assert.ok(r.published_at);
  assert.equal(r.published_by, ADMIN);
  assert.equal((await dl.getDownloadByVersionPlatform("4.3.0", "macos"))?.id, m.id);
});

// ---------- rollback (last: it drops the columns) ----------

test("0106 rollback refuses while a draft exists, and runs once there is none", async () => {
  await pb.confirmPublishedBuild(build("4.9.0").args);
  const rollback = readFileSync(path.join(MIGRATIONS, "0106_rollback.sql"), "utf8");
  await assert.rejects(db.exec(rollback), /draft rows/);
  await db.exec("rollback");
  assert.ok((await sql(`select 1 from information_schema.columns where table_name = 'downloads' and column_name = 'published_at'`)).rowCount);
  await sql(`update downloads set deleted_at = now() where published_at is null and deleted_at is null`);
  await db.exec(rollback);
  assert.equal((await sql(`select 1 from information_schema.columns where table_name = 'downloads' and column_name in ('published_at', 'published_by', 'mapping_sha256', 'mapping_size_bytes')`)).rowCount, 0);
  assert.equal((await sql(`select 1 from schema_migrations where version = '0106'`)).rowCount, 0);
});
