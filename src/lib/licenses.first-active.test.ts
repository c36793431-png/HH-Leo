/** isFirstActiveLicense against real Postgres. Leo's read (bus m53048 section C, relayed by
 * marcus m53080): the gate tested status = 'active' with no expiry test, so a lapsed holder
 * given a new license through issueLicense skipped the activation notify and the auto payment
 * row. Every case runs inside one transaction on a TEMP `licenses` table (pg_temp is searched
 * before public for relations) and rolls back, so no real table is read or written. Still:
 * point HH_TEST_DATABASE_URL at a scratch Neon branch, never production.
 *
 * Run: HH_TEST_DATABASE_URL=... node --import jiti/register --test src/lib/licenses.first-active.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@neondatabase/serverless";
import { isFirstActiveLicense } from "./licenses";

const url = process.env.HH_TEST_DATABASE_URL;

async function withTempLicenses(fn: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      `create temp table licenses (
         id uuid primary key default gen_random_uuid(),
         user_id uuid,
         claim_email text,
         claim_telegram_user_id bigint,
         status text not null,
         expires_at timestamptz not null
       ) on commit drop`
    );
    await fn(client);
  } finally {
    await client.query("rollback");
    await client.end();
  }
}

async function insertLicense(
  client: Client,
  row: { userId?: string; claimEmail?: string; status: "active" | "revoked"; expiresIn: string }
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into licenses (user_id, claim_email, status, expires_at)
     values ($1, $2, $3, now() + $4::interval) returning id`,
    [row.userId ?? null, row.claimEmail ?? null, row.status, row.expiresIn]
  );
  return result.rows[0].id;
}

const USER = "00000000-0000-4000-8000-000000000001";

test("expired active license + new issue => counts as first activation", { skip: !url }, async () => {
  await withTempLicenses(async (client) => {
    await insertLicense(client, { userId: USER, status: "active", expiresIn: "-1 day" });
    const newId = await insertLicense(client, { userId: USER, status: "active", expiresIn: "30 days" });
    assert.equal(await isFirstActiveLicense({ newLicenseId: newId, userId: USER }, client), true);
  });
});

test("expired active claim_email license + new pre-provision => counts as first activation", { skip: !url }, async () => {
  await withTempLicenses(async (client) => {
    await insertLicense(client, { claimEmail: "lapsed@example.test", status: "active", expiresIn: "-1 day" });
    const newId = await insertLicense(client, { claimEmail: "lapsed@example.test", status: "active", expiresIn: "30 days" });
    assert.equal(await isFirstActiveLicense({ newLicenseId: newId, claimEmail: "lapsed@example.test" }, client), true);
  });
});

test("unexpired active license + new issue => NOT a first activation", { skip: !url }, async () => {
  await withTempLicenses(async (client) => {
    await insertLicense(client, { userId: USER, status: "active", expiresIn: "1 day" });
    const newId = await insertLicense(client, { userId: USER, status: "active", expiresIn: "30 days" });
    assert.equal(await isFirstActiveLicense({ newLicenseId: newId, userId: USER }, client), false);
  });
});
