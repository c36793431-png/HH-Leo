/* Run: npx tsx --test src/lib/assign-feed.test.ts
 *
 * The agent assign-feed CLI (marcus m60735 scope, m60748 go): the panel's "Feed provider
 * assignment" and scripts/assign-feed.mts write the same feed_subscriptions, allowlist and
 * admin_actions rows, differing only in the actor; the dry run makes ZERO writes (counted, m60748
 * condition a) and never allocates a pseudonym; every refusal refuses before a write; the output
 * prints the IP the provider still allowlists by hand (condition b) and never a licence key.
 * Same harness as assign-trial.test.ts: in-memory PGlite on the REAL migration chain. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const SEED_PROVIDER = "00000000-0000-4000-8000-0000000000a1";
const OTHER_PROVIDER = "00000000-0000-4000-8000-0000000000a2";
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

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let af: typeof import("./assign-feed");
let aft: typeof import("./assign-feed-tier");
let fs: typeof import("./feed-subscriptions");
let actorId = "";

// Every statement the shipped code sends through the pool, and every connect() (a transaction).
const statements: string[] = [];
let connects = 0;

async function sql(text: string, params: unknown[] = []) {
  statements.push(text);
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}

/** A statement that writes or takes a lock: DML/DDL anywhere in it (CTEs included), a row lock,
 * an advisory lock, a sequence bump, or transaction control. */
const WRITE_RE =
  /\b(insert\s+into|delete\s+from|truncate|merge\s+into|create|alter|drop|begin|commit|nextval|setval|pg_advisory\w*)\b|\bupdate\s+[\w.]+(\s+(as\s+)?\w+)?\s+set\b|\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i;

/** Next transaction id the database would hand out. Any committed or rolled-back write takes one,
 * so an unchanged value means nothing wrote, whatever path the SQL took. Read off-harness. */
async function nextXid(): Promise<string> {
  return String((await db.query(`select pg_snapshot_xmax(pg_current_snapshot())::text as x`)).rows[0].x);
}

/** Runs fn and counts what it wrote: write statements, transactions opened, xids consumed. */
async function countWrites(fn: () => Promise<unknown>) {
  const [s0, c0, x0] = [statements.length, connects, await nextXid()];
  await fn();
  const sent = statements.slice(s0);
  return { writeStatements: sent.filter((s) => WRITE_RE.test(s)), connects: connects - c0, xidMoved: (await nextXid()) !== x0, sent };
}

async function tableCounts() {
  const r = await db.query(`select
      (select count(*) from feed_subscriptions)::int as subs,
      (select count(*) from feed_allowlist_records)::int as allow,
      (select count(*) from provider_client_pseudonyms)::int as pseud,
      (select coalesce(sum(next_seq), 0)::int from provider_pseudonym_counters) as counters,
      (select count(*) from admin_actions)::int as actions`);
  return r.rows[0];
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
    connect: async () => {
      connects++;
      return { query: sql, release() {} };
    },
    end: async () => {},
  };
  process.env.NEON_DATABASE_URL = "postgres://unused";
  // The grant path sends nothing. Any fetch is a failure.
  (globalThis as any).fetch = async (url: string) => {
    throw new Error(`unexpected outbound fetch: ${url}`);
  };
  af = await import("./assign-feed");
  aft = await import("./assign-feed-tier");
  fs = await import("./feed-subscriptions");

  await db.query(`insert into users (id, email, role) values ($1, 'hfthorizon@keemail.me', 'admin')`, [ADMIN]);
  await db.query(`insert into users (id, email, role) values ($1, 'other-provider@example.invalid', 'feed_provider')`, [OTHER_PROVIDER]);
  await db.exec(readFileSync(path.join(process.cwd(), "scripts/seed-agent-actor.sql"), "utf8"));
  actorId = (await db.query(`select id from users where email = 'marcus-agent@horizonhft.internal'`)).rows[0].id;
});

let seq = 0;
/** A client with one active licence (feeds) and, unless server:false, its registered server. */
async function makeClient(opts: { feeds?: string[]; server?: boolean; licence?: boolean; email?: string } = {}) {
  seq++;
  const email = opts.email ?? `feedclient${seq}@example.invalid`;
  const u = (await db.query(`insert into users (email) values ($1) returning id`, [email])).rows[0].id as string;
  if (opts.licence === false) return { id: u, email, licenceId: "", licenceKey: "", serverId: "", ip: "" };
  const key = `HHFT-FEED${seq}-SECRET-KEY${seq}`;
  const l = (
    await db.query(`insert into licenses (user_id, license_key, expires_at, feed_types) values ($1, $2, now() + interval '30 days', $3) returning id`, [
      u,
      key,
      opts.feeds ?? ["london", "ny"],
    ])
  ).rows[0].id as string;
  let serverId = "";
  const ip = `203.0.113.${seq}`;
  if (opts.server !== false) {
    serverId = (
      await db.query(
        `insert into server_registrations (license_id, user_id, server_name, vps_provider, server_location, declared_ip)
         values ($1, $2, $3, 'other', 'London', $4) returning id`,
        [l, u, `box-${seq}`, ip]
      )
    ).rows[0].id;
  }
  return { id: u, email, licenceId: l, licenceKey: key, serverId, ip };
}

const plan = (user: string, tierKey = "ld-beta-56", allowInternal = false) => af.planFeed({ user, tierKey, execute: false, allowInternal });

async function subRow(userId: string, tierKey: string) {
  return (
    await db.query(
      `select s.provider_user_id, s.license_id, s.server_registration_id, s.status, s.ends_at, s.lapsed_at, s.access_request_id, s.price_cents,
              l.expires_at as licence_expires
       from feed_subscriptions s join feed_tiers ft on ft.id = s.feed_tier_id join licenses l on l.id = s.license_id
       where s.subscriber_user_id = $1 and ft.tier_key = $2`,
      [userId, tierKey]
    )
  ).rows;
}

test("UI vs CLI: the same subscription, allowlist and pseudonym rows; only the actor (and via) differ", async () => {
  const a = await makeClient();
  const b = await makeClient();

  const ui = await aft.assignFeedTierForUser({ actorUserId: ADMIN, userId: a.id, tierKey: "ld-beta-56" });
  const cli = await af.executeFeed(await plan(b.id));

  const [ra, rb] = [await subRow(a.id, "ld-beta-56"), await subRow(b.id, "ld-beta-56")];
  assert.equal(ra.length, 1);
  assert.equal(rb.length, 1);
  for (const k of ["provider_user_id", "status", "lapsed_at", "access_request_id", "price_cents"]) assert.deepEqual(rb[0][k], ra[0][k], k);
  assert.equal(rb[0].license_id, b.licenceId);
  assert.equal(rb[0].server_registration_id, b.serverId);
  assert.equal(rb[0].status, "active");
  assert.equal(new Date(rb[0].ends_at).getTime(), new Date(rb[0].licence_expires).getTime(), "ends with the licence");

  assert.equal(ui.outcome, "created");
  assert.equal(cli.outcome, "created");
  assert.equal(cli.declaredIp, b.ip);

  for (const c of [a, b]) {
    const al = (await db.query(`select ip, told_at from feed_allowlist_records where server_registration_id = $1`, [c.serverId])).rows;
    assert.equal(al.length, 1);
    assert.equal(al[0].ip, c.ip);
    const ps = (await db.query(`select seq from provider_client_pseudonyms where provider_user_id = $1 and subscriber_user_id = $2`, [SEED_PROVIDER, c.id])).rows;
    assert.equal(ps.length, 1, "the grant allocates the pair's pseudonym, both paths");
  }

  const actions = async (uid: string) =>
    (await db.query(`select admin_user_id, action_type, target_license_id, details_json from admin_actions where target_user_id = $1`, [uid])).rows;
  const [aa, ab] = [await actions(a.id), await actions(b.id)];
  assert.equal(aa.length, 1);
  assert.equal(ab.length, 1);
  assert.equal(aa[0].admin_user_id, ADMIN);
  assert.equal(ab[0].admin_user_id, actorId, "CLI rows carry the agent actor");
  assert.equal(ab[0].action_type, aa[0].action_type);
  assert.equal(ab[0].target_license_id, aa[0].target_license_id);
  assert.deepEqual(aa[0].details_json, { tierKey: "ld-beta-56" }, "the panel's details are unchanged: no via key");
  assert.deepEqual(ab[0].details_json, { tierKey: "ld-beta-56", via: "cli" });
});

test("the write counter is not blind: pseudonymForSubscriber and a real grant both register", async () => {
  const c = await makeClient();
  const allocate = await countWrites(() => fs.pseudonymForSubscriber(OTHER_PROVIDER, c.id));
  assert.ok(allocate.writeStatements.length > 0, "pseudonymForSubscriber writes");
  assert.ok(allocate.xidMoved, "and takes an xid");
  const grant = await countWrites(async () => af.executeFeed(await plan(c.id)));
  assert.ok(grant.writeStatements.length > 0);
  assert.ok(grant.connects > 0);
  assert.ok(grant.xidMoved);
});

test("dry run: 0 writes, 0 transactions, no xid, and the plan says what execute would do", async (t) => {
  await t.test("create (no pseudonym yet, no allowlist record yet)", async () => {
    const c = await makeClient();
    const t0 = await tableCounts();
    let p!: Awaited<ReturnType<typeof plan>>;
    const w = await countWrites(async () => {
      p = await plan(c.email, "ld-gamma-19");
    });
    assert.deepEqual(w.writeStatements, [], "write statements during the dry run");
    assert.equal(w.connects, 0, "no pool.connect: no transaction");
    assert.equal(w.xidMoved, false, "no xid consumed");
    assert.ok(w.sent.length > 0, "it did read");
    assert.deepEqual(await tableCounts(), t0);

    assert.deepEqual(p.refusals, []);
    assert.equal(p.outcome, "created");
    assert.equal(p.pseudonymExists, false);
    assert.equal(p.allowlistRecorded, false);
    assert.equal(p.server?.declaredIp, c.ip);
    assert.equal(p.boundLicence?.id, c.licenceId);

    // The prediction is what the real grant then does.
    const r = await af.executeFeed(p);
    assert.equal(r.outcome, "created");
    assert.equal(r.declaredIp, c.ip);
  });

  await t.test("reactivate a lapsed row", async () => {
    const c = await makeClient();
    await af.executeFeed(await plan(c.id));
    await fs.deactivateFeedTierSubscription(c.id, "ld-beta-56");
    const w = await countWrites(async () => {
      const p = await plan(c.id);
      assert.equal(p.outcome, "reactivated");
      assert.equal(p.existingRow?.status, "lapsed");
      assert.equal(p.pseudonymExists, true);
    });
    assert.deepEqual(w.writeStatements, []);
    assert.equal(w.xidMoved, false);
    assert.equal((await af.executeFeed(await plan(c.id))).outcome, "reactivated");
    assert.equal((await subRow(c.id, "ld-beta-56"))[0].status, "active");
  });

  await t.test("re-point a row whose tier changed provider (the branch that allocates)", async () => {
    const c = await makeClient();
    await af.executeFeed(await plan(c.id, "ld-delta-18"));
    // The panel re-grants a tier only after a Revoke (S2), so the re-point is from a lapsed row.
    await fs.deactivateFeedTierSubscription(c.id, "ld-delta-18");
    await db.query(`update feed_tiers set provider_user_id = $1 where tier_key = 'ld-delta-18'`, [OTHER_PROVIDER]);
    try {
      const t0 = await tableCounts();
      const w = await countWrites(async () => {
        const p = await plan(c.id, "ld-delta-18");
        assert.equal(p.outcome, "repointed");
        assert.equal(p.pseudonymExists, false, "no pair with the new provider yet");
      });
      assert.deepEqual(w.writeStatements, []);
      assert.equal(w.xidMoved, false);
      assert.deepEqual(await tableCounts(), t0, "no pseudonym allocated by the dry run");
      assert.equal((await af.executeFeed(await plan(c.id, "ld-delta-18"))).outcome, "repointed");
      assert.equal((await subRow(c.id, "ld-delta-18"))[0].provider_user_id, OTHER_PROVIDER);
    } finally {
      await db.query(`update feed_tiers set provider_user_id = $1 where tier_key = 'ld-delta-18'`, [SEED_PROVIDER]);
    }
  });

  await t.test("a refused plan also writes nothing", async () => {
    const c = await makeClient({ server: false });
    const w = await countWrites(() => plan(c.id));
    assert.deepEqual(w.writeStatements, []);
    assert.equal(w.xidMoved, false);
  });
});

test("each refusal refuses before any write, and matches what the grant itself would do", async (t) => {
  const refuses = async (label: string, userId: string, tierKey: string, match: RegExp, opts: { env?: Record<string, string>; real?: RegExp } = {}) => {
    const t0 = await tableCounts();
    const p = await af.planFeed({ user: userId, tierKey, execute: true, allowInternal: false }, opts.env);
    assert.ok(p.refusals.some((r) => match.test(r)), `${label}: ${p.refusals.join(" | ")}`);
    await assert.rejects(af.executeFeed(p), /^Error: Refusing: /, label);
    assert.deepEqual(await tableCounts(), t0, `${label}: nothing written`);
    // Where the grant has the same refusal, prove the plan mirrors it rather than inventing one.
    if (opts.real) await assert.rejects(fs.assignFeedTierSubscription(userId, tierKey), opts.real, `${label}: the grant refuses too`);
  };

  await t.test("missing env", async () => {
    const c = await makeClient();
    await refuses("env", c.id, "ld-beta-56", /Missing env: NEON_DATABASE_URL/, { env: {} });
  });
  await t.test("tier has no provider", async () => {
    const c = await makeClient();
    await db.query(`update feed_tiers set provider_user_id = null where tier_key = 'ld-gamma-19'`);
    try {
      await refuses("no provider", c.id, "ld-gamma-19", /no provider account/, { real: /isn't assigned to a provider/ });
    } finally {
      await db.query(`update feed_tiers set provider_user_id = $1 where tier_key = 'ld-gamma-19'`, [SEED_PROVIDER]);
    }
  });
  await t.test("no active licence", async () => {
    const c = await makeClient({ licence: false });
    await refuses("no licence", c.id, "ld-beta-56", /No active, unexpired licence/, { real: /no active, unexpired licence/ });
  });
  await t.test("two active licences", async () => {
    const c = await makeClient();
    await db.query(`insert into licenses (user_id, license_key, expires_at, feed_types) values ($1, 'SECOND-${seq}', now() + interval '9 days', array['london'])`, [c.id]);
    await refuses("two licences", c.id, "ld-beta-56", /2 active licences/, { real: /holds 2 active licences/ });
  });
  await t.test("no registered server", async () => {
    const c = await makeClient({ server: false });
    await refuses("no server", c.id, "ld-beta-56", /has no registered server/, { real: /has no registered server/ });
  });
  await t.test("a tier the panel would not offer (licence feeds don't cover the region)", async () => {
    const c = await makeClient({ feeds: ["ny"] });
    await refuses("picker gate", c.id, "ld-beta-56", /would not offer/);
  });
  // fable m60813 S1/S2: the Grant button's own disable, not just the picker's region gate. Each
  // case checks the panel's input too (the rows page.tsx renders from), so form and CLI agree.
  const panelBlockers = async (userId: string, entitled: string[], tierKey: string) => {
    const rows = fs.computeFeedAssignmentRows(
      await fs.listFeedTiersForAdminPicker(),
      await fs.getFeedTierSubscriptionsForSubscriber(userId),
      entitled as Parameters<typeof fs.computeFeedAssignmentRows>[2]
    );
    return rows.find((r) => r.tiers.some((x) => x.tierKey === tierKey))?.grantBlockers[tierKey];
  };
  await t.test("entitlement lapsed: the licence dropped london, the client keeps a london row (S1)", async () => {
    const c = await makeClient({ feeds: ["london", "ny"] });
    await af.executeFeed(await plan(c.id, "ld-beta-56"));
    await db.query(`update licenses set feed_types = array['ny'] where id = $1`, [c.licenceId]);
    for (const tierKey of ["ld-gamma-19", "ld-beta-56"]) {
      assert.ok((await panelBlockers(c.id, ["ny"], tierKey))?.some((r) => /Entitlement lapsed/.test(r)), `panel disables ${tierKey}`);
      await refuses(`lapsed ${tierKey}`, c.id, tierKey, /Entitlement lapsed: .* region london/);
    }
    // The grant itself has no such check: before this gate the CLI CREATED a london row here.
    await assert.doesNotReject(fs.assignFeedTierSubscription(c.id, "ld-gamma-19"), "the grant alone would have written");
  });
  await t.test("a live row: the panel grants it again only after a Revoke (S2)", async () => {
    const c = await makeClient();
    await af.executeFeed(await plan(c.id));
    assert.ok((await panelBlockers(c.id, ["london", "ny"], "ld-beta-56"))?.some((r) => /already live \(active\)/.test(r)), "panel disables it");
    await refuses("live", c.id, "ld-beta-56", /already live \(active\).*Revoke/);
    await fs.deactivateFeedTierSubscription(c.id, "ld-beta-56");
    assert.deepEqual(await panelBlockers(c.id, ["london", "ny"], "ld-beta-56"), [], "enabled after a Revoke");
    assert.deepEqual((await plan(c.id)).refusals, []);
  });
  await t.test("a live row for this licence and tier on no server (0081 index)", async () => {
    const c = await makeClient();
    await db.query(
      `insert into feed_subscriptions (provider_user_id, subscriber_user_id, license_id, feed_tier_id, status, ends_at)
       select $1, $2, $3, id, 'active', now() + interval '30 days' from feed_tiers where tier_key = 'ld-beta-56'`,
      [SEED_PROVIDER, c.id, c.licenceId]
    );
    await refuses("window", c.id, "ld-beta-56", /already holds a live/, { real: /already has a live/ });
  });
  await t.test("missing actor row", async () => {
    const c = await makeClient();
    await db.query(`update users set email = 'parked-agent@example.invalid' where id = $1`, [actorId]);
    try {
      await refuses("actor", c.id, "ld-beta-56", /seed-agent-actor\.sql/);
    } finally {
      await db.query(`update users set email = 'marcus-agent@horizonhft.internal' where id = $1`, [actorId]);
    }
  });
  await t.test("internal or test target without --allow-internal: the actor itself, *.internal, *test*; granted with it", async () => {
    await refuses("actor", actorId, "ld-beta-56", /internal or test account/);
    for (const email of [`qa-feed${seq + 1}@horizonhft.internal`, `feedtester${seq + 1}@example.invalid`]) {
      const c = await makeClient({ email });
      // Otherwise grantable: this rule is the only thing refusing it.
      const p = await plan(c.id);
      assert.equal(p.refusals.length, 1, p.refusals.join(" | "));
      await refuses(email, c.id, "ld-beta-56", /internal or test account.*--allow-internal/);
      const allowed = await plan(c.id, "ld-beta-56", true);
      assert.deepEqual(allowed.refusals, []);
      assert.equal((await af.executeFeed(allowed)).outcome, "created");
    }
  });
  await t.test("unknown tier, no user", async () => {
    const c = await makeClient();
    await assert.rejects(plan(c.id, "ld-nope"), /Unknown tier "ld-nope"\. Known: .*ld-beta-56/);
    await assert.rejects(plan("nobody@example.invalid"), /No user matches/);
  });
});

test("argv: --user and --tier required, unknown flag refused, dry run by default", () => {
  const p = (s: string) => af.parseAssignFeedArgs(s.split(" "));
  assert.throws(() => p("--tier ld-beta-56"), /--user is required/);
  assert.throws(() => p("--user x"), /--tier is required/);
  assert.throws(() => p("--user x --tier ld-beta-56 --force"), /Unknown argument/);
  assert.throws(() => p("--user x --tier"), /--tier needs a value/);
  assert.deepEqual(p("--user x --tier=ld-beta-56 --execute"), { user: "x", tierKey: "ld-beta-56", execute: true, allowInternal: false });
  assert.equal(p("--user x --tier ld-beta-56").execute, false);
  assert.equal(p("--user x --tier ld-beta-56 --allow-internal").allowInternal, true);
  assert.throws(() => p("--user x --tier ld-beta-56 --allow-internal=yes"), /Unknown argument/);
});

async function runScript(argv: string[], tag: string) {
  const lines: string[] = [];
  const [saved, log] = [process.argv, console.log];
  process.argv = [saved[0], "scripts/assign-feed.mts", ...argv];
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    await import(`../../scripts/assign-feed.mjs?${tag}`);
  } finally {
    process.argv = saved;
    console.log = log;
  }
  return lines.join("\n");
}

test("the script itself: the dry run writes nothing and names the IP; --execute grants; no key printed", async () => {
  const c = await makeClient();
  const t0 = await tableCounts();
  let dry = "";
  const w = await countWrites(async () => {
    dry = await runScript(["--user", c.email, "--tier", "ld-beta-56"], "dry");
  });
  assert.deepEqual(w.writeStatements, [], dry);
  assert.equal(w.xidMoved, false);
  assert.deepEqual(await tableCounts(), t0);
  assert.match(dry, /^DRY RUN/m);
  assert.match(dry, /Would grant/);
  assert.ok(dry.includes(`still has to allowlist the client's IP ${c.ip}`), dry);
  assert.ok(!dry.includes(c.licenceKey), "no licence key in the dry run");
  assert.ok(!process.exitCode, dry);

  const out = await runScript(["--user", c.email, "--tier", "ld-beta-56", "--execute"], "exec");
  assert.equal((await subRow(c.id, "ld-beta-56")).length, 1, out);
  assert.match(out, /GRANTED  ld-beta-56  created/);
  assert.ok(out.includes(`still has to allowlist the client's IP ${c.ip}`), out);
  assert.ok(!out.includes(c.licenceKey), "no licence key on execute");
  assert.ok(!process.exitCode, out);
});
