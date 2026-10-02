/* Run: npx tsx --test src/lib/feed-pseudonym-allocation.test.ts
 *
 * Pseudonyms are allocated on VIEW (marcus m57800, ruling (ii) extended): the provider panel's
 * loaders give a pending requester their HH number on render, through maskIdentity ->
 * pseudonymForSubscriber, which commits on its own connection. Before m57800 one render allocated
 * once per ROW, so a package (one envelope per tier, same requester) burned a counter value per
 * extra tier. This file pins: one allocation per requester per render, none on a re-render, and the
 * approval transaction still assigning, and still rolling its assignment back when the approve fails.
 *
 * ONE PGlite session. Calls run concurrently with Promise.all interleave their statements on it,
 * inside what Postgres sees as one transaction, and an advisory lock is re-entrant within a session.
 * So this file cannot show the pair lock in assignPseudonymSeq holding off a SECOND session; that
 * needs a multi-session Postgres.
 *
 * Same chain as access-requests-admin-trial.test.ts: every non-rollback migration in order, 0046 and
 * 0081 seeded with the minimum their preflights assert, 0082 (a data-only prod backfill) skipped. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const PIP = "00000000-0000-4000-8000-00000000b001";
const ADMIN = "00000000-0000-4000-8000-00000000b002";
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
let db: PGlite;
let lib: {
  ar: typeof import("./access-requests");
  ftr: typeof import("./feed-tier-requests");
  providers: typeof import("./feed-providers");
  subs: typeof import("./feed-subscriptions");
};

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  // PGlite reports affectedRows 0 for a SELECT, so a read's rowCount is its row count, as pg's is.
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
  // The approval DMs the buyer; capture instead of sending.
  process.env.TELEGRAM_HFT_ALERT_BOT_TOKEN = "test-token";
  delete process.env.AUTH_RESEND_KEY;
  (globalThis as any).fetch = async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });

  lib = {
    ar: await import("./access-requests"),
    ftr: await import("./feed-tier-requests"),
    providers: await import("./feed-providers"),
    subs: await import("./feed-subscriptions"),
  };
  await sql(`insert into users (id, email, role) values ($1, 'pip@example.invalid', 'feed_provider'), ($2, 'admin@example.invalid', 'admin')`, [PIP, ADMIN]);
  await sql(`update feed_tiers set provider_user_id = $1 where tier_key in ('ny-normal', 'ny-fast')`, [PIP]);
});

let buyerSeq = 0;
/** A buyer with a live licence and one server, and a pending NY request on each of `tierKeys`
 * (both NY tiers = the NY package: one batch, one envelope per tier). */
async function pendingBuyer(tierKeys: string[]) {
  buyerSeq++;
  const userId = (await sql(`insert into users (email, telegram_user_id) values ($1, $2) returning id`, [`buyer${buyerSeq}@example.invalid`, 9100 + buyerSeq])).rows[0].id as string;
  const licenseId = (await sql(
    `insert into licenses (user_id, license_key, expires_at) values ($1, $2, now() + interval '60 days') returning id`,
    [userId, `KEY-PSEUDO-${buyerSeq}`]
  )).rows[0].id as string;
  const serverId = (await sql(
    `insert into server_registrations (license_id, user_id, server_name, vps_provider, server_location, declared_ip)
     values ($1, $2, 'srv', 'other', 'NY', $3) returning id`,
    [licenseId, userId, `10.2.0.${buyerSeq}`]
  )).rows[0].id as string;
  const tiers = (await sql(`select id from feed_tiers where tier_key = any($1) order by tier_key`, [tierKeys])).rows;
  const { requestIds } = await lib.ar.createAccessRequestBatch({
    userId,
    items: tiers.map((t) => ({ kind: "feed_tier" as const, serverRegistrationId: serverId, feedTierId: t.id as string })),
  });
  return { userId, licenseId, serverId, requestIds };
}

/** Pip's counter and this buyer's pseudonym rows under Pip. */
async function pseudonymState(userId: string) {
  const rows = (await sql(`select seq from provider_client_pseudonyms where provider_user_id = $1 and subscriber_user_id = $2`, [PIP, userId])).rows;
  const nextSeq = (await sql(`select next_seq from provider_pseudonym_counters where provider_user_id = $1`, [PIP])).rows[0]?.next_seq ?? 1;
  return { seqs: rows.map((r) => r.seq as number), nextSeq: nextSeq as number };
}

test("R1: one render of the Approvals loader allocates ONCE for a requester with a two-tier package: counter +1, one row, no burn", async () => {
  const b = await pendingBuyer(["ny-fast", "ny-normal"]);
  const before = await pseudonymState(b.userId);
  assert.equal(before.seqs.length, 0);

  const rows = await lib.providers.listPendingRequestsForProvider(PIP);
  const after = await pseudonymState(b.userId);
  assert.equal(after.seqs.length, 1);
  assert.equal(after.nextSeq - before.nextSeq, 1, "seqs consumed: one per requester, not one per row");
  const mine = rows.filter((r) => r.userId === b.userId);
  assert.equal(mine.length, 2, "both package rows still listed");
  assert.deepEqual(mine.map((r) => r.userEmail), [`HH${after.seqs[0]}`, `HH${after.seqs[0]}`], "both rows carry the one allocated label");
});

test("a re-render reuses the row: the counter does not move", async () => {
  const b = await pendingBuyer(["ny-fast", "ny-normal"]);
  await lib.providers.listPendingRequestsForProvider(PIP);
  const first = await pseudonymState(b.userId);
  await lib.providers.listPendingRequestsForProvider(PIP);
  const second = await pseudonymState(b.userId);
  assert.deepEqual(second, first);
});

test("approveOnClient still assigns on the approval transaction, and reuses a render's allocation", async () => {
  // Never rendered: the approval allocates.
  const a = await pendingBuyer(["ny-fast"]);
  const beforeA = await pseudonymState(a.userId);
  await lib.ftr.approveFeedTierRequest(a.requestIds[0], ADMIN, "u", { decision: "paid", endsAt: new Date(Date.now() + 30 * 864e5), invoiceRef: "INV-P1" });
  const afterA = await pseudonymState(a.userId);
  assert.equal(afterA.seqs.length, 1);
  assert.equal(afterA.nextSeq - beforeA.nextSeq, 1);
  assert.equal((await sql(`select count(*)::int as n from feed_subscriptions where access_request_id = $1`, [a.requestIds[0]])).rows[0].n, 1);

  // Rendered first (the usual order on prod): the approval keeps that seq and bumps nothing.
  const b = await pendingBuyer(["ny-fast"]);
  await lib.providers.listPendingRequestsForProvider(PIP);
  const rendered = await pseudonymState(b.userId);
  await lib.ftr.approveFeedTierRequest(b.requestIds[0], ADMIN, "u", { decision: "paid", endsAt: new Date(Date.now() + 30 * 864e5), invoiceRef: "INV-P2" });
  assert.deepEqual(await pseudonymState(b.userId), rendered);
});

test("a failed approve rolls its assignment back: no pseudonym row, counter unmoved, envelope still pending", async () => {
  const b = await pendingBuyer(["ny-fast"]);
  // A live grant already on this server + tier, under ANOTHER provider and written by hand (no
  // pseudonym for Pip): approveOnClient assigns Pip's seq, then its insert hits the live
  // (server, tier) index and the whole approval rolls back.
  const tier = (await sql(`select id from feed_tiers where tier_key = 'ny-fast'`)).rows[0].id;
  await sql(
    `insert into feed_subscriptions (provider_user_id, subscriber_user_id, license_id, server_registration_id, feed_tier_id, status, ends_at)
     values ($1, $2, $3, $4, $5, 'active', now() + interval '30 days')`,
    [SEED_PROVIDER, b.userId, b.licenseId, b.serverId, tier]
  );
  const before = await pseudonymState(b.userId);
  assert.equal(before.seqs.length, 0);

  await assert.rejects(
    lib.ftr.approveFeedTierRequest(b.requestIds[0], ADMIN, "u", { decision: "paid", endsAt: new Date(Date.now() + 30 * 864e5), invoiceRef: "INV-P3" }),
    lib.subs.DuplicateTierGrantError
  );
  assert.deepEqual(await pseudonymState(b.userId), before);
  assert.equal((await sql(`select status from access_requests where id = $1`, [b.requestIds[0]])).rows[0].status, "pending");
  assert.equal((await sql(`select count(*)::int as n from feed_subscriptions where access_request_id = $1`, [b.requestIds[0]])).rows[0].n, 0);
});
