/* Run: npx tsx --test src/lib/request-package-groups.test.tsx
 *
 * Package rows on the provider panel's Approvals list and the admin queue (marcus m57786 (a)).
 * Fixture rows, no database: the grouping helper, then both lists rendered to static HTML and
 * read for the label and the per-tier controls. node:test via tsx, as tier-request-state.test.ts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { groupRequestsByPackage } from "./request-package-groups";
import type { FeedTierRequestRow } from "./feed-tier-requests";
import { PendingApprovalsList } from "../components/feed/pending-approvals-list";
import { FeedTierRequestRows } from "../components/admin/feed-tier-request-rows";

const NY_LABEL = "NY Base Package (NY Alpha / NY Beta)";
const LD_LABEL = "LD Base Package (Beta 56 / Gamma 19 / Delta 18)";
const NAMES: Record<string, string> = {
  "ny-fast": "NY Alpha",
  "ny-normal": "NY Beta",
  "ld-beta-56": "LD Beta 56",
  "ld-gamma-19": "LD Gamma 19",
  "ld-delta-18": "LD Delta 18",
  "cme-ctrader-fix": "CME Futures · cTrader FIX",
};
const AT = new Date("2026-09-29T10:26:59.308Z");

function row(id: string, batchId: string, tierKey: string, over: Partial<FeedTierRequestRow> = {}): FeedTierRequestRow {
  return {
    id,
    userId: "u-sky",
    userName: "HH23",
    userEmail: "HH23",
    licenseId: "lic-1",
    licenseKeyTail: "ABCD",
    telegramUserId: null,
    region: tierKey.startsWith("ld-") ? "london" : tierKey.startsWith("cme") ? "cme" : "ny",
    tierKey,
    tierName: NAMES[tierKey],
    serverName: "srv-ny",
    serverIp: "10.0.0.1",
    serverRegistered: true,
    status: "pending",
    reason: null,
    createdAt: AT,
    actionedAt: null,
    batchId,
    decision: null,
    endsAt: null,
    invoiceRef: null,
    decidedBy: null,
    ...over,
  } as FeedTierRequestRow;
}

const noop = async () => ({ ok: true as const });
const strip = (html: string) => html.replace(/<!-- -->/g, "");
const count = (html: string, s: string) => html.split(s).length - 1;

test("a NY batch of both tiers is ONE package group, labelled as the Telegram card names it, members in label order", () => {
  // Loader order is ft.tier_key within a batch: ny-fast < ny-normal, but feed it reversed to prove the sort.
  const groups = groupRequestsByPackage([row("e2", "b1", "ny-normal"), row("e1", "b1", "ny-fast")]);
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.equal(g.kind, "package");
  if (g.kind !== "package") return;
  assert.equal(g.label, NY_LABEL);
  assert.equal(g.packageKey, "ny-retail-package");
  assert.deepEqual(g.members.map((m) => m.tierKey), ["ny-fast", "ny-normal"]);
});

test("the three LD Base tiers in one batch group under the LD label", () => {
  const groups = groupRequestsByPackage([row("a", "b", "ld-delta-18"), row("c", "b", "ld-beta-56"), row("d", "b", "ld-gamma-19")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind === "package" && groups[0].label, LD_LABEL);
  assert.deepEqual(groups[0].kind === "package" && groups[0].members.map((m) => m.tierKey), ["ld-beta-56", "ld-gamma-19", "ld-delta-18"]);
});

test("not a package: part of a package, a package plus an extra tier, the same tiers across two batches", () => {
  const partial = groupRequestsByPackage([row("a", "b1", "ld-beta-56"), row("b", "b1", "ld-gamma-19")]);
  assert.deepEqual(partial.map((g) => g.kind), ["single", "single"]);

  const extra = groupRequestsByPackage([row("a", "b1", "ny-fast"), row("b", "b1", "ny-normal"), row("c", "b1", "cme-ctrader-fix")]);
  assert.deepEqual(extra.map((g) => g.kind), ["single", "single", "single"]);

  const split = groupRequestsByPackage([row("a", "b1", "ny-fast"), row("b", "b2", "ny-normal")]);
  assert.deepEqual(split.map((g) => g.kind), ["single", "single"]);
});

test("a filtered-out member breaks the set: the admin 'pending' view of a half-decided NY batch shows the pending tier alone", () => {
  const groups = groupRequestsByPackage([row("a", "b1", "ny-normal")]);
  assert.deepEqual(groups.map((g) => g.kind), ["single"]);
});

test("order is kept: a package sits where its first member was, singles around it untouched", () => {
  const groups = groupRequestsByPackage([
    row("s1", "x1", "cme-ctrader-fix"),
    row("p2", "b1", "ny-normal"),
    row("s2", "x2", "ld-beta-56"),
    row("p1", "b1", "ny-fast"),
  ]);
  assert.deepEqual(
    groups.map((g) => (g.kind === "single" ? g.row.id : `pkg:${g.members.map((m) => m.id).join("+")}`)),
    ["s1", "pkg:p1+p2", "s2"]
  );
});

test("provider panel render: one row for the NY package, the label once, each tier with its own Approve and Deny", () => {
  const html = strip(
    renderToStaticMarkup(
      <PendingApprovalsList
        pending={[row("e2", "b1", "ny-normal"), row("e1", "b1", "ny-fast"), row("c1", "b9", "cme-ctrader-fix")]}
        approveAction={noop}
        rejectAction={noop}
      />
    )
  );
  assert.equal(count(html, 'class="qrow'), 2, "the package and the CME request: two rows, not three");
  assert.equal(count(html, NY_LABEL), 1);
  assert.equal(count(html, 'class="qtier"'), 2);
  assert.ok(html.indexOf("NY Alpha</span>") < html.indexOf("NY Beta</span>"), "members in label order");
  assert.equal(count(html, "✓ Approve &amp; activate"), 3, "one Approve per envelope: 2 NY + 1 CME");
  assert.equal(count(html, ">Deny<"), 3);
  assert.equal(count(html, "CME Futures · cTrader FIX"), 1, "the single row is unchanged");
  assert.equal(count(html, 'class="qexpand"'), 1);
});

test("provider panel render, control: no package in the list renders exactly as one row per envelope", () => {
  const html = strip(
    renderToStaticMarkup(
      <PendingApprovalsList pending={[row("a", "b1", "ny-fast"), row("b", "b2", "ny-normal")]} approveAction={noop} rejectAction={noop} />
    )
  );
  assert.equal(count(html, 'class="qrow'), 2);
  assert.equal(count(html, "Base Package"), 0);
  assert.equal(count(html, 'class="qtier"'), 0);
});

test("admin queue render: a label row naming the package, then each member row with its own Approve and Reject", () => {
  const html = strip(
    renderToStaticMarkup(
      <table>
        <tbody>
          <FeedTierRequestRows
            requests={[
              row("e1", "b1", "ny-fast", { userName: "Alonzo", userEmail: "sky@example.invalid" }),
              row("e2", "b1", "ny-normal", { userName: "Alonzo", userEmail: "sky@example.invalid" }),
              row("c1", "b9", "cme-ctrader-fix", { status: "approved", decision: "paid" }),
            ]}
            approveAction={noop}
            rejectAction={noop}
          />
        </tbody>
      </table>
    )
  );
  assert.equal(count(html, `📦 ${NY_LABEL}`), 1);
  assert.match(html, /Alonzo · 2 tiers from one request/);
  assert.equal(count(html, "<tr"), 4, "label row + 2 members + the CME row");
  assert.equal(count(html, ">Approve<"), 2, "the approved CME row has no controls; each NY tier has one");
  assert.equal(count(html, ">Reject<"), 2);
  assert.equal(count(html, "└ "), 2);
});
