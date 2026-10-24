/* Run: python3 /root/claudeclaw-leo/scripts/run_worktree_test.py <worktree> src/lib/release-notices-0117.test.ts
 *
 * Release notice sha 1 (marcus m74741/m74769/m75122; plan v2 m74764; Fable m75121 S1/S3/C6/C7/C8): migration 0117 and
 * the audience in lib/release-notices.ts. Pinned here:
 *  - 0117 applies on the real chain; users.release_updates_opt_out_at is null for every existing user; the CHECKs on
 *    both tables (audience, channel, the S1 status set, finished iff not claimed, attempts <= 3, the all-or-none
 *    approval, the sha shape) and the (user, version, channel) key.
 *  - THE AUDIENCE: one audience per user (several licence rows never duplicate a user); active -> A; expired-only,
 *    revoked-only and no licence -> B; internal/test in neither; an opt-out leaves B but NOT A; A wins.
 *  - A IS isPaidUser: the fragment is pinned to isPaidUser's WHERE in licenses.ts, and isPaidUser(user) agrees with
 *    "user is in A" for every non-internal user. notAClientSql is imported, not copied (C8).
 *  - the buckets (tg_only / email_only / both / unreachable) incl. a blocked TG with no email -> unreachable but still
 *    tried; the dry-run counts incl. excluded internal/test, unclaimed licences, opted out, expired clients in B and
 *    admins in B (C6/C7).
 *  - 0117_rollback refuses while a run, a delivery or an opt-out exists, then drops everything.
 * Real Postgres, no prod: the PGlite harness of consult-s3-0116.test.ts. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
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
let rn: typeof import("./release-notices");
let lic: typeof import("./licenses");

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
  (globalThis as any)._pgPool = { query: sql, connect: async () => ({ query: sql, release() {} }) };
  rn = await import("./release-notices");
  lic = await import("./licenses");
});

let seq = 0;
interface UserOpts {
  email?: string | null;
  tg?: number | null;
  role?: "user" | "admin";
  optOut?: boolean;
  botStarted?: boolean;
  dm?: "ok" | "blocked";
}
async function user(label: string, o: UserOpts = {}): Promise<string> {
  const email = o.email === undefined ? `${label}-${++seq}@example.invalid` : o.email;
  return (await sql(
    `insert into users (email, telegram_user_id, role, release_updates_opt_out_at, telegram_bot_started_at, tg_last_dm_at, tg_last_dm_ok, tg_last_dm_error)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      email,
      o.tg ?? null,
      o.role ?? "user",
      o.optOut ? new Date() : null,
      o.botStarted ? new Date(Date.now() - 86_400_000) : null,
      o.dm ? new Date() : null,
      o.dm ? o.dm === "ok" : null,
      o.dm === "blocked" ? "403 Forbidden: bot was blocked by the user" : null,
    ],
  )).rows[0].id;
}
let keySeq = 0;
async function licence(userId: string | null, kind: "active" | "expired" | "revoked", extra: { claimEmail?: string; claimTg?: number } = {}) {
  const expires = kind === "expired" ? "now() - interval '3 days'" : "now() + interval '30 days'";
  await sql(
    `insert into licenses (user_id, license_key, status, expires_at, claim_email, claim_telegram_user_id)
     values ($1, $2, $3, ${expires}, $4, $5)`,
    [userId, `RN-${++keySeq}`, kind === "revoked" ? "revoked" : "active", extra.claimEmail ?? null, extra.claimTg ?? null],
  );
}
const count = async (table: string, where = "true", params: unknown[] = []) =>
  (await sql(`select count(*)::int n from ${table} where ${where}`, params)).rows[0].n as number;
const audienceOf = async (id: string) => (await rn.loadAudience()).find((r) => r.userId === id)?.audience ?? null;
async function rejects(q: string, params: unknown[], re: RegExp) {
  await assert.rejects(() => sql(q, params), re);
}

// ---------- the migration ----------

test("0117 applies on the real chain: the opt-out column is null for every existing user, both tables exist", async () => {
  assert.equal(await count("users", "release_updates_opt_out_at is not null"), 0);
  assert.equal(await count("release_notice_runs"), 0);
  assert.equal(await count("release_notice_deliveries"), 0);
  assert.equal(await count("schema_migrations", "version = '0117'"), 1);
  const col = (await sql(`select data_type, is_nullable from information_schema.columns where table_name = 'users' and column_name = 'release_updates_opt_out_at'`)).rows[0];
  assert.deepEqual({ ...col }, { data_type: "timestamp with time zone", is_nullable: "YES" });
});

const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);
async function run(over: Record<string, unknown> = {}): Promise<string> {
  const v = {
    version: "2.2", a_subject: "Horizon 2.2 is ready", a_text_tg: "a tg", a_text_email: "a email", a_sha256: SHA,
    b_subject: "Horizon 2.2 is out", b_text_tg: "b tg", b_text_email: "b email", b_sha256: SHA2, ...over,
  };
  const cols = Object.keys(v);
  return (await sql(`insert into release_notice_runs (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(v))).rows[0].id;
}

test("release_notice_runs CHECKs: sha shape, TG length 4096, the approval is all-or-none", async () => {
  await rejects(`insert into release_notice_runs (version, a_subject, a_text_tg, a_text_email, a_sha256, b_subject, b_text_tg, b_text_email, b_sha256)
                 values ('2.2','s','t','e','NOTHEX','s','t','e',$1)`, [SHA], /a_sha256_check/);
  await rejects(`insert into release_notice_runs (version, a_subject, a_text_tg, a_text_email, a_sha256, b_subject, b_text_tg, b_text_email, b_sha256)
                 values ('2.2','s',$1,'e',$2,'s','t','e',$2)`, ["x".repeat(4097), SHA], /a_text_tg_check/);
  const id = await run();
  assert.ok(id);
  const admin = await user("rn-admin", { role: "admin" });
  // approved_at without a ref / without the shas, and a ref without approved_at: all refused
  await rejects(`update release_notice_runs set approved_at = now() where id = $1`, [id], /approval_all_or_none/);
  await rejects(`update release_notice_runs set approved_at = now(), approved_ref = 'm1', approved_a_sha256 = $2 where id = $1`, [id, SHA], /approval_all_or_none/);
  await rejects(`update release_notice_runs set approved_ref = 'm1' where id = $1`, [id], /approval_all_or_none/);
  await sql(`update release_notice_runs set approved_at = now(), approved_ref = 'm1', approved_by = $2, approved_a_sha256 = $3, approved_b_sha256 = $4 where id = $1`, [id, admin, SHA, SHA2]);
  assert.equal(await count("release_notice_runs", "approved_at is not null"), 1);
});

test("release_notice_deliveries CHECKs: audience, channel, the S1 status set, finished iff not claimed, attempts <= 3", async () => {
  const u = await user("rn-del");
  const id = await run({ version: "9.1" });
  const ins = (over: Record<string, unknown>) => {
    const v = { run_id: id, user_id: u, version: "9.1", audience: "A", channel: "telegram", ...over };
    const cols = Object.keys(v);
    return sql(`insert into release_notice_deliveries (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(v));
  };
  await assert.rejects(() => ins({ audience: "C" }), /audience_check/);
  await assert.rejects(() => ins({ channel: "sms" }), /channel_check/);
  await assert.rejects(() => ins({ status: "failed", finished_at: new Date() }), /status_check/); // v1's single 'failed' is gone: two classes now
  await assert.rejects(() => ins({ attempts: 4 }), /attempts_check/);
  await assert.rejects(() => ins({ status: "sent" }), /finished_iff_not_claimed/); // sent without finished_at
  await assert.rejects(() => ins({ status: "claimed", finished_at: new Date() }), /finished_iff_not_claimed/);
  // every legal status is accepted (one version each, since the key is per version + channel)
  await ins({ version: "9.1", channel: "telegram", status: "sent", finished_at: new Date(), attempts: 1 });
  await ins({ version: "9.3", channel: "telegram", status: "failed_retry", finished_at: new Date(), attempts: 3, retry_after_until: new Date() });
  await ins({ version: "9.4", channel: "telegram", status: "failed_final", finished_at: new Date(), error: "403 Forbidden" });
  await ins({ version: "9.1", channel: "email", status: "claimed" });
  // the key: a second row for the same (user, version, channel) is refused
  await assert.rejects(() => ins({ version: "9.1", channel: "email", status: "claimed" }), /key_uniq/);
  // another version is a different key
  await ins({ version: "9.2", channel: "email", status: "claimed" });
});

// ---------- the audience ----------

test("A = a paid licence; expired-only, revoked-only and no licence -> B; several licence rows never duplicate a user", async () => {
  const active = await user("rn-active");
  const expired = await user("rn-expired");
  const revoked = await user("rn-revoked");
  const none = await user("rn-none");
  const many = await user("rn-many");
  await licence(active, "active");
  await licence(expired, "expired");
  await licence(revoked, "revoked");
  await licence(many, "active");
  await licence(many, "active");
  await licence(many, "expired");
  await licence(many, "revoked");
  assert.equal(await audienceOf(active), "A");
  assert.equal(await audienceOf(expired), "B", "expired-only is B (marcus Q7)");
  assert.equal(await audienceOf(revoked), "B");
  assert.equal(await audienceOf(none), "B");
  assert.equal(await audienceOf(many), "A", "A wins over the user's other rows");
  const rows = await rn.loadAudience();
  assert.equal(rows.filter((r) => r.userId === many).length, 1, "one row per user, whatever the licence rows");
  assert.equal(new Set(rows.map((r) => r.userId)).size, rows.length, "no user is in both audiences or twice");
});

test("internal/test accounts are in neither audience, with or without a licence", async () => {
  const internal = await user("rn-int", { email: "ops@horizonhft.internal" });
  const testy = await user("rn-test", { email: "my-TEST-account@example.invalid" });
  const internalPaid = await user("rn-intpaid", { email: "boss@horizonhft.internal" });
  await licence(internalPaid, "active");
  for (const id of [internal, testy, internalPaid]) assert.equal(await audienceOf(id), null);
  // a Telegram-only account (email NULL) is still a user: coalesce in notAClientSql keeps it in
  const tgOnly = await user("rn-tgonly", { email: null, tg: 7_000_001 });
  assert.equal(await audienceOf(tgOnly), "B");
});

test("the opt-out leaves B and does NOT leave A", async () => {
  const bOut = await user("rn-bout", { optOut: true });
  const aOut = await user("rn-aout", { optOut: true });
  await licence(aOut, "active");
  assert.equal(await audienceOf(bOut), null, "an unsubscribed B user is not sent to");
  assert.equal(await audienceOf(aOut), "A", "A is a service notice: the B unsubscribe does not apply");
});

test("A IS isPaidUser: the fragment is pinned to its WHERE, and the two agree for every non-internal user", async () => {
  // 1. the SQL text: take isPaidUser's WHERE from the shipped source and require the fragment to carry the same predicate
  const src = readFileSync(path.join(process.cwd(), "src/lib/licenses.ts"), "utf8");
  const fn = /export async function isPaidUser[\s\S]*?\n\}/.exec(src)?.[0] ?? "";
  const where = /where user_id = \$1 and (status = 'active' and expires_at > now\(\))/.exec(fn)?.[1];
  assert.ok(where, "isPaidUser's WHERE moved: re-pin the audience (release-notices.ts paidLicenceSql) to the new predicate");
  const norm = (s: string) => s.replace(/\bpl\./g, "").replace(/\s+/g, " ").trim();
  assert.ok(norm(rn.paidLicenceSql("u")).includes(norm(where)), "paidLicenceSql must carry isPaidUser's predicate verbatim");
  // 2. the behaviour: for every user in the audience, A <=> isPaidUser
  const rows = await rn.loadAudience();
  assert.ok(rows.length > 10, "the matrix above gave some users to compare");
  for (const r of rows) assert.equal(await lic.isPaidUser(r.userId), r.audience === "A", `isPaidUser and audience disagree for ${r.userId}`);
  // 3. the seeded users from the chain (active 90-day licences) are A, so the comparison saw both sides
  assert.ok(rows.some((r) => r.audience === "A") && rows.some((r) => r.audience === "B"));
});

test("notAClientSql is imported, never copied (C8)", () => {
  const src = readFileSync(path.join(process.cwd(), "src/lib/release-notices.ts"), "utf8");
  assert.match(src, /import \{ notAClientSql \} from "\.\/licenses"/);
  assert.doesNotMatch(src, /horizonhft\.internal|%test%/, "no copy of the internal/test rule");
  assert.match(src, /audienceASql[\s\S]*notAClientSql\(alias\)/);
  assert.match(src, /audienceBSql[\s\S]*notAClientSql\(alias\)/);
});

// ---------- buckets + counts ----------

test("buckets: both = TG + email (no fallback); a blocked TG with no email is unreachable but still has its TG channel", async () => {
  const ids = {
    both: await user("rn-both", { tg: 7_100_001 }),
    emailOnly: await user("rn-email"),
    tgDelivered: await user("rn-tgok", { email: null, tg: 7_100_002, dm: "ok" }),
    tgStarted: await user("rn-tgstart", { email: null, tg: 7_100_003, botStarted: true }),
    tgBlocked: await user("rn-tgblock", { email: null, tg: 7_100_004, dm: "blocked" }),
    tgUntried: await user("rn-tguntried", { email: null, tg: 7_100_005 }),
    nothing: await user("rn-nothing", { email: null }),
    blockedWithEmail: await user("rn-blockedmail", { tg: 7_100_006, dm: "blocked" }),
  };
  const rows = await rn.loadAudience();
  const bucket = (id: string) => rn.classify(rows.find((r) => r.userId === id)!);
  const channels = (id: string) => rn.channelsFor(rows.find((r) => r.userId === id)!);
  assert.equal(bucket(ids.both), "both");
  assert.deepEqual(channels(ids.both), ["telegram", "email"], "both channels, independent sends");
  assert.equal(bucket(ids.emailOnly), "email_only");
  assert.deepEqual(channels(ids.emailOnly), ["email"]);
  assert.equal(bucket(ids.tgDelivered), "tg_only");
  assert.equal(bucket(ids.tgStarted), "tg_only");
  assert.equal(bucket(ids.tgBlocked), "unreachable");
  assert.deepEqual(channels(ids.tgBlocked), ["telegram"], "still tried once (Q2)");
  assert.equal(bucket(ids.tgUntried), "unreachable");
  assert.equal(bucket(ids.nothing), "unreachable");
  assert.deepEqual(channels(ids.nothing), []);
  assert.equal(bucket(ids.blockedWithEmail), "both", "blocked TG but an email: still both channels");
});

test("dry-run counts: totals add up, and the C6/C7/Q7 lines are right (deltas against what the chain seeded)", async () => {
  const before = await rn.dryRunAudience();
  const a1 = await user("rn-c-a1", { tg: 7_200_001 });
  await licence(a1, "active");
  const a2 = await user("rn-c-a2");
  await licence(a2, "active");
  const bExpired = await user("rn-c-bexp", { email: null, tg: 7_200_002, dm: "ok" });
  await licence(bExpired, "expired");
  const bRevoked = await user("rn-c-brev");
  await licence(bRevoked, "revoked");
  const bPlain = await user("rn-c-bplain");
  const bAdmin = await user("rn-c-badmin", { role: "admin" });
  await user("rn-c-bout", { optOut: true });
  const aOptedOut = await user("rn-c-aout", { optOut: true }); // paid + unsubscribed: stays in A, is not "B opted out"
  await licence(aOptedOut, "active");
  await user("rn-c-int", { email: "x@horizonhft.internal" });
  await licence(null, "active", { claimEmail: "pending@example.invalid" });
  await licence(null, "expired", { claimEmail: "old@example.invalid" });
  await licence(null, "revoked", { claimEmail: "gone@example.invalid" });
  assert.ok(bPlain && bAdmin);

  const after = await rn.dryRunAudience();
  const d = (f: (c: typeof after.counts) => number) => f(after.counts) - f(before.counts);
  assert.equal(d((c) => c.A.total), 3);
  assert.equal(d((c) => c.A.both), 1);
  assert.equal(d((c) => c.A.email_only), 2);
  assert.equal(d((c) => c.B.total), 4, "expired, revoked, plain, admin; the opted-out and internal ones are not in B");
  assert.equal(d((c) => c.B.tg_only), 1);
  assert.equal(d((c) => c.B.email_only), 3);
  assert.equal(d((c) => c.expired_clients_in_b), 1, "only the expired client: a revoked-only user holds no row with status <> 'revoked'");
  assert.equal(d((c) => c.admins_in_b), 1, "an admin without a licence lands in B (C7)");
  assert.equal(d((c) => c.b_opted_out), 1, "only the unpaid unsubscribed user; the paid one is in A");
  assert.equal(d((c) => c.excluded_internal_test), 1);
  assert.equal(d((c) => c.unclaimed_licences), 1, "active + unexpired + no account; the expired and revoked unclaimed ones are not counted");
  assert.deepEqual(after.unclaimed.filter((l) => l.claimEmail === "pending@example.invalid").map((l) => Object.keys(l).sort()), [["claimEmail", "claimTelegramUserId", "expiresAt", "id"]], "the list carries no licence key");
  // the frozen list is the audience: same users, same order, each once, with its audience + channels
  const rows = await rn.loadAudience();
  assert.deepEqual(after.recipients.map((r) => r.user_id), rows.map((r) => r.userId));
  assert.equal(after.recipients.length, after.counts.A.total + after.counts.B.total);
  for (const b of ["A", "B"] as const) {
    const c = after.counts[b];
    assert.equal(c.tg_only + c.email_only + c.both + c.unreachable, c.total, `${b}: the four buckets add up to the total`);
  }
});

// ---------- the rollback ----------

test("0117_rollback refuses while a run, a delivery or an opt-out exists, then drops everything", async () => {
  const rollback = readFileSync(path.join(MIGRATIONS, "0117_rollback.sql"), "utf8");
  // own fixtures, so this does not depend on what the tests above left behind
  const u = await user("rn-rb", { optOut: true });
  const r = await run({ version: "7.7" });
  await sql(`insert into release_notice_deliveries (run_id, user_id, version, audience, channel) values ($1, $2, '7.7', 'B', 'email')`, [r, u]);
  await assert.rejects(() => db.exec(rollback), /0117 rollback: release_notice_deliveries has rows/);
  await db.exec(`rollback`).catch(() => {});
  await sql(`delete from release_notice_deliveries`);
  await assert.rejects(() => db.exec(rollback), /0117 rollback: release_notice_runs has rows/);
  await db.exec(`rollback`).catch(() => {});
  await sql(`delete from release_notice_runs`);
  await assert.rejects(() => db.exec(rollback), /0117 rollback: users have opted out/);
  await db.exec(`rollback`).catch(() => {});
  await sql(`update users set release_updates_opt_out_at = null`);
  await db.exec(rollback);
  assert.equal((await sql(`select count(*)::int n from information_schema.tables where table_name like 'release_notice%'`)).rows[0].n, 0);
  assert.equal((await sql(`select count(*)::int n from information_schema.columns where column_name = 'release_updates_opt_out_at'`)).rows[0].n, 0);
  assert.equal(await count("schema_migrations", "version = '0117'"), 0);
  // and it applies again cleanly (the migration is the same file the chain ran)
  await db.exec(readFileSync(path.join(MIGRATIONS, "0117_release_notices.sql"), "utf8"));
  assert.equal(await count("schema_migrations", "version = '0117'"), 1);
});
