/* Run: npx tsx --test src/lib/my-requests-history.test.ts
 *
 * My requests history (marcus m59979): one vocabulary across every source, a click is one row,
 * a grant is the outcome on its request row, free text is cut down. Pure mappers, no database. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_STATUSES,
  accessHistoryRows,
  basketHistoryRow,
  blackTrialHistoryRow,
  cutText,
  feedRequestHistoryRow,
  feedTrialHistoryRow,
  legacyTierHistoryRow,
  licenceHistoryRow,
  sortHistory,
  strategyRequestHistoryRow,
  strategySubmissionHistoryRow,
} from "./my-requests-history";
import type { AccessRequestRow } from "./access-requests";

const NOW = new Date("2026-10-04T15:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function envelope(over: Partial<AccessRequestRow>): AccessRequestRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    userId: "u",
    productKind: "feed_tier",
    batchId: "b1",
    status: "pending",
    decision: null,
    endsAt: null,
    invoiceRef: null,
    reason: null,
    decidedBy: null,
    decidedAt: null,
    legacyFeedTierRequestId: null,
    createdAt: day(-3),
    userName: null,
    userEmail: null,
    telegramUserId: null,
    serverRegistrationId: null,
    feedTierId: null,
    tierKey: "ny-fast",
    tierName: "NY Fast",
    regionKey: "ny",
    serverName: null,
    declaredIp: null,
    licenseId: null,
    licenseKey: null,
    productId: null,
    ...over,
  };
}

test("access: one row per batch; pending anywhere = Sent; a decision is the outcome", () => {
  const rows = accessHistoryRows(
    [
      envelope({ id: "a1", batchId: "b1", tierKey: "ny-fast", status: "pending" }),
      envelope({ id: "a2", batchId: "b1", tierKey: "ny-normal", status: "approved", decision: "trial", endsAt: day(5) }),
      envelope({ id: "a3", batchId: "b2", status: "approved", decision: "trial", endsAt: day(-1), createdAt: day(-20) }),
      envelope({ id: "a4", batchId: "b3", status: "rejected", createdAt: day(-30) }),
    ],
    NOW
  );
  assert.equal(rows.length, 3, "three clicks, three rows");
  const b1 = rows.find((r) => r.key === "access:b1")!;
  assert.equal(b1.status, "Sent", "the row pill stays Sent while a tier is pending");
  assert.equal(b1.items.length, 2);
  // m59992: the approved tier is not hidden behind "Sent"; each tier has its own small status.
  assert.deepEqual(b1.itemStatuses, ["Sent", `Approved, trial until ${day(5).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`]);
  assert.equal(b1.outcome, null, "a mixed click has no single outcome");
  const b2 = rows.find((r) => r.key === "access:b2")!;
  assert.equal(b2.status, "Approved");
  assert.match(b2.outcome ?? "", /^Trial ended /);
  assert.equal(b2.itemStatuses, undefined, "a one-tier click needs no per-tier status");
  assert.equal(rows.find((r) => r.key === "access:b3")!.status, "Declined");
});

test("access: per-tier statuses only when the tiers differ", () => {
  const rows = accessHistoryRows(
    [
      envelope({ id: "c1", batchId: "same", tierKey: "ny-fast", status: "approved", decision: "trial", endsAt: day(5) }),
      envelope({ id: "c2", batchId: "same", tierKey: "ny-normal", status: "approved", decision: "trial", endsAt: day(5) }),
      envelope({ id: "d1", batchId: "split", tierKey: "ny-fast", status: "approved", decision: "paid", endsAt: day(30) }),
      envelope({ id: "d2", batchId: "split", tierKey: "ny-normal", status: "rejected" }),
    ],
    NOW
  );
  const same = rows.find((r) => r.key === "access:same")!;
  assert.equal(same.itemStatuses, undefined);
  assert.match(same.outcome ?? "", /^Trial until /);
  const split = rows.find((r) => r.key === "access:split")!;
  assert.equal(split.status, "Approved");
  assert.equal(split.outcome, null);
  assert.match(split.itemStatuses?.[0] ?? "", /^Approved, access until /);
  assert.equal(split.itemStatuses?.[1], "Declined");
});

test("every mapper speaks only the seven words", () => {
  const all = [
    basketHistoryRow({ id: "11111111-2222-4333-8444-555555555555", reference: "REQ-11111111", userId: "u", userName: null, userEmail: null, telegram: null, lines: [{ kind: "strategy", key: "obi", name: "OBI" }], hasTrial: true, status: "new", handledAt: null, handledByEmail: null, submittedAt: day(-1) }),
    legacyTierHistoryRow({ id: "31cd1813-5994-4946-bc3e-b5e1f3a52f64", tierKey: "ld-beta-56", status: "pending", createdAt: day(-51) }),
    ...["new", "reviewing", "declined", "shipped"].map((s) => feedRequestHistoryRow({ id: "f", text: "x", status: s, at: day(-2) })),
    ...["new", "reviewing", "scoping", "declined", "shipped"].map((s) => strategyRequestHistoryRow({ id: "s", text: "x", status: s, at: day(-2) })),
    ...["pending", "under_review", "approved_draft", "listed", "declined", "withdrawn"].map((s) => strategySubmissionHistoryRow({ id: "s", text: "x", status: s, at: day(-2) })),
    ...(["active", "expired", "converted", "cancelled"] as const).map((s) => feedTrialHistoryRow({ id: "t", tierKey: "ny-fast", status: s, startedAt: day(-6), endsAt: day(1) }, NOW)),
    ...(["requested", "active", "declined", "converted"] as const).map((s) => blackTrialHistoryRow({ id: "k", status: s, requestedAt: day(-6), expiresAt: day(3) }, NOW)),
  ];
  for (const r of all) assert.ok((HISTORY_STATUSES as readonly string[]).includes(r.status), `${r.key}: ${r.status}`);
  assert.equal(all[0].status, "Sent");
  assert.ok(all[0].items.includes("Start with a 30-day trial"));
  assert.equal(all[1].status, "Sent", "the legacy pending row reads Sent");
});

test("licences: active, expired and revoked; only the key's last 4 are shown", () => {
  const base = { id: "l", keyTail: "AB12", tier: "paid", issuedAt: day(-40) };
  const active = licenceHistoryRow({ ...base, status: "active", expiresAt: day(20) }, NOW);
  const expired = licenceHistoryRow({ ...base, status: "active", expiresAt: day(-2) }, NOW);
  const revoked = licenceHistoryRow({ ...base, status: "revoked", expiresAt: day(20) }, NOW);
  assert.equal(active.status, "Active");
  assert.match(active.outcome ?? "", /^Until /);
  assert.equal(expired.status, "Ended");
  assert.equal(revoked.status, "Ended");
  assert.equal(revoked.outcome, "Revoked");
  assert.equal(active.reference, "Key ••••AB12");
});

test("free text is cut down to 80 characters with an ellipsis", () => {
  const long = "a ".repeat(100);
  const cut = cutText(long);
  assert.ok(cut.length <= 80);
  assert.ok(cut.endsWith("…"));
  assert.equal(cutText("  short   idea "), "short idea");
});

test("sort: newest first, ties broken by key", () => {
  const mk = (key: string, at: Date) => ({ key, source: "basket" as const, at, kind: "", items: [], status: "Sent" as const, outcome: null, reference: "" });
  const sorted = sortHistory([mk("b", day(-1)), mk("a", day(-1)), mk("c", day(0))]);
  assert.deepEqual(sorted.map((r) => r.key), ["c", "a", "b"]);
});
