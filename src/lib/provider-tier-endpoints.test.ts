/* Run: npx tsx --test src/lib/provider-tier-endpoints.test.ts
 *
 * The repo has no test runner; node:test via tsx needs nothing installed. Pure functions only:
 * the SQL reader and writers of provider-tier-endpoints.ts need Postgres and are not here.
 *
 * Fail-first per docs/specs/0091-tier-endpoints-design.md @ 6100dc0, section 5 (:293-339):
 * these cases were written before the module existed, so the first run fails on a missing
 * export. Test numbers below follow section 5's items: 5.1 guard, 5.2 carry (+ narrowing),
 * 5.3 parser, 5.4 display resolver (delta 3), 5.5 reader assert.
 *
 * NOT RUN on the author's box (npx tsx --test refused 2026-09-24; design 5, :296-299). An unrun
 * test is not a PASS input (fable N5). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  carryVerification,
  endpointsThatWouldClear,
  endpointViewerAllowed,
  assertEndpointViewer,
  EndpointViewerError,
  parseEndpointsJson,
  parentMirror,
  foldEndpointRows,
  resolveEndpointsForDisplay,
  MAX_ENDPOINTS_PER_PARENT,
  type EndpointInput,
  type LiveEndpoint,
} from "./provider-tier-endpoints";

function row(over: Partial<EndpointInput> = {}): EndpointInput {
  return {
    position: 0,
    protocol: "FIX 4.4",
    endpointHost: "fix.example.net",
    endpointPort: "9443",
    compid: "BLACKFF01",
    notes: null,
    ...over,
  };
}

function live(over: Partial<LiveEndpoint> = {}): LiveEndpoint {
  return { ...row(), endpointVerified: false, ...over };
}

const A = row();
const B = row({ position: 1, endpointHost: "sbe.example.net", endpointPort: "7000", compid: "BLACKSBE" });
const C = row({ position: 2, endpointHost: "ctrader.example.net", endpointPort: "5201", protocol: "cTrader", compid: null });

/* ---------- 5.1 endpointsThatWouldClear, clause 1 (removal key = host:port) ---------- */

test("5.1 live [A, B], submitted [A]: B is missing, described as host:port", () => {
  const out = endpointsThatWouldClear([live(A), live(B)], [A]);
  assert.deepEqual(out, ["sbe.example.net:7000"]);
});

test("5.1 live [A], submitted [A with different notes]: nothing to refuse, notes are not identity", () => {
  const out = endpointsThatWouldClear([live({ notes: "BJF session" })], [row({ notes: "the BJF one" })]);
  assert.deepEqual(out, []);
});

test("5.1 live [A], submitted [A with different compid]: an edit, not a removal", () => {
  const out = endpointsThatWouldClear([live(A)], [row({ compid: "BLACKFF02" })]);
  assert.deepEqual(out, []);
});

test("5.1 live [], submitted []: first round, nothing to destroy", () => {
  assert.deepEqual(endpointsThatWouldClear([], []), []);
});

test("5.1 live [A], submitted [A, C]: adding is free", () => {
  assert.deepEqual(endpointsThatWouldClear([live(A)], [A, C]), []);
});

test("5.1 N2: a live row with no host and no port is echoed as (no address), never as an empty string", () => {
  // marcus m53979 (fable m53977) N2: a backfilled address-less parent lands as a child row with
  // host and port null. Clause 1 can never match it (the parser refuses address-less submitted
  // rows), so it is refused on every submission until coxwell fixes the row by SQL, and the
  // echo must say so readably.
  const out = endpointsThatWouldClear(
    [live({ endpointHost: null, endpointPort: null, protocol: "FIX 4.4", compid: "ORPHAN" })],
    [A]
  );
  assert.deepEqual(out, ["(no address)"]);
  assert.ok(!out.some((s) => s === "" || s === ":"));
});

test("5.1 the echo never carries the note", () => {
  const out = endpointsThatWouldClear([live({ ...B, notes: "SECRET NOTE" })], [A]);
  assert.equal(out.length, 1);
  assert.ok(!out[0].includes("SECRET NOTE"));
});

/* ---------- 5.2 carryVerification, keyed on the four coalesced ---------- */

test("5.2 [A verified] -> [A, B]: A carries true, B starts false", () => {
  const out = carryVerification([live({ endpointVerified: true })], [A, B]);
  assert.deepEqual(
    out.map((r) => [r.position, r.endpointVerified]),
    [
      [0, true],
      [1, false],
    ]
  );
});

test("5.2 after [A with new port]: false", () => {
  const out = carryVerification([live({ endpointVerified: true })], [row({ endpointPort: "9444" })]);
  assert.deepEqual(out.map((r) => r.endpointVerified), [false]);
});

test("5.2 after [A with new compid]: false (S1 tightening; today's UPDATE :494-499 would keep true)", () => {
  const out = carryVerification([live({ endpointVerified: true })], [row({ compid: "BLACKFF02" })]);
  assert.deepEqual(out.map((r) => r.endpointVerified), [false]);
});

test("5.2 after [A with compid null] where before had compid null: true (null == null via coalesce)", () => {
  const before = live({ compid: null, endpointVerified: true });
  const out = carryVerification([before], [row({ compid: null })]);
  assert.deepEqual(out.map((r) => r.endpointVerified), [true]);
});

test("5.2 [A verified, B verified] at one host:port, different compids -> after [B]: B true only", () => {
  const a = live({ compid: "C1", endpointVerified: true });
  const b = live({ position: 1, compid: "C2", endpointVerified: true });
  const out = carryVerification([a, b], [row({ compid: "C2" })]);
  assert.deepEqual(out.map((r) => [r.compid, r.endpointVerified]), [["C2", true]]);
});

test("5.2 same pair -> after [C at that host:port, third compid]: false", () => {
  const a = live({ compid: "C1", endpointVerified: true });
  const b = live({ position: 1, compid: "C2", endpointVerified: true });
  const out = carryVerification([a, b], [row({ compid: "C3" })]);
  assert.deepEqual(out.map((r) => r.endpointVerified), [false]);
});

test("5.2 after []: []", () => {
  assert.deepEqual(carryVerification([live({ endpointVerified: true })], []), []);
});

test("5.2 carry does not key on notes: a note change keeps a verified row verified", () => {
  const out = carryVerification([live({ notes: "old", endpointVerified: true })], [row({ notes: "new" })]);
  assert.deepEqual(out.map((r) => r.endpointVerified), [true]);
});

/* ---------- 5.2 narrowing, ruled m53894 via m53896: guard + carry on one input ---------- */

test("5.2 narrowing: same host:port with compid blank -> refused, echo names the compid box, never the note", () => {
  const before = live({ compid: "BLACKFF01", notes: "SECRET NOTE", endpointVerified: true });
  const submitted = row({ compid: null, notes: "SECRET NOTE" });
  const refused = endpointsThatWouldClear([before], [submitted]);
  assert.equal(refused.length, 1, "clause 2 must refuse the blank");
  assert.ok(refused[0].includes("SenderCompID"), refused[0]);
  assert.ok(refused[0].includes("fix.example.net:9443"), refused[0]);
  assert.ok(!refused[0].includes("SECRET NOTE"), refused[0]);
  assert.ok(!refused[0].includes("BLACKFF01"), "the live value is a claim the echo does not need to repeat");
});

test("5.2 narrowing: same host:port with a different compid -> accepted, carry misses, verified false", () => {
  const before = live({ compid: "BLACKFF01", endpointVerified: true });
  const submitted = row({ compid: "BLACKFF02" });
  assert.deepEqual(endpointsThatWouldClear([before], [submitted]), []);
  assert.deepEqual(carryVerification([before], [submitted]).map((r) => r.endpointVerified), [false]);
});

test("5.2 narrowing: same host:port with protocol blank on a row that had one -> refused, echo names Protocol", () => {
  const before = live({ protocol: "FIX 4.4", endpointVerified: true });
  const submitted = row({ protocol: null });
  const refused = endpointsThatWouldClear([before], [submitted]);
  assert.equal(refused.length, 1);
  assert.ok(refused[0].includes("Protocol"), refused[0]);
});

test("5.2 narrowing: null -> set is an add, allowed", () => {
  const before = live({ compid: null, protocol: null });
  assert.deepEqual(endpointsThatWouldClear([before], [row({ compid: "NEW", protocol: "FIX 4.4" })]), []);
});

test("5.2 S1: two live sessions at one address, one resubmitted: the other is a removal, counted per address", () => {
  // Live A(C1) and B(C2) share host:port. Submitting [A(C1), B(C2)] keeps both; submitting
  // [B(C2)] alone drops A, and at 2b183a4 the guard let that through ("kept if ANY submitted row
  // at the address has it set"): fable's delta-1 strike S1 (m54026 via marcus m54028, probe P1).
  // The guard now counts rows per address.
  const a = live({ compid: "C1", endpointVerified: true });
  const b = live({ position: 1, compid: "C2", endpointVerified: true });
  assert.deepEqual(endpointsThatWouldClear([a, b], [row({ compid: "C2" })]), [
    "1 of 2 endpoints removed at fix.example.net:9443",
  ]);
  assert.deepEqual(endpointsThatWouldClear([a, b], [row({ compid: "C1" }), row({ position: 1, compid: "C2" })]), []);
});

test("5.2 S1 probe P2: same live pair, one submitted row with a third compid: still 1 of 2 removed, not a narrowing", () => {
  const a = live({ compid: "C1", endpointVerified: true });
  const b = live({ position: 1, compid: "C2", endpointVerified: true });
  const out = endpointsThatWouldClear([a, b], [row({ compid: "C3" })]);
  assert.deepEqual(out, ["1 of 2 endpoints removed at fix.example.net:9443"]);
});

test("5.2 S1: an edit at a shared address with the neighbour kept is allowed (C1 -> C3, B kept)", () => {
  const a = live({ compid: "C1" });
  const b = live({ position: 1, compid: "C2" });
  assert.deepEqual(endpointsThatWouldClear([a, b], [row({ compid: "C3" }), row({ position: 1, compid: "C2" })]), []);
});

test("5.2 S1 (ii): two live rows with compid at one address, both resubmitted but one compid blanked: SenderCompID left blank, once", () => {
  const a = live({ compid: "C1" });
  const b = live({ position: 1, compid: "C2" });
  const out = endpointsThatWouldClear([a, b], [row({ compid: "C1" }), row({ position: 1, compid: null })]);
  assert.deepEqual(out, ["SenderCompID left blank at fix.example.net:9443"]);
});

test("5.2 N2: two live rows at one address, address absent from the submission: echoed once", () => {
  const a = live({ compid: "C1" });
  const b = live({ position: 1, compid: "C2" });
  assert.deepEqual(endpointsThatWouldClear([a, b], [B]), ["fix.example.net:9443"]);
});

test("5.2 Q4 (fable m54051 N2, marcus mutant M5): two keyless live rows with the same description are echoed once", () => {
  const a = live({ endpointPort: null, compid: "C1" });
  const b = live({ position: 1, endpointPort: null, compid: "C2" });
  assert.deepEqual(endpointsThatWouldClear([a, b], [A]), ["fix.example.net:(no port)"]);
});

test("5.2 Q4b: two keyless live rows missing different halves are two distinct echoes", () => {
  const a = live({ endpointPort: null });
  const b = live({ position: 1, endpointHost: null });
  assert.deepEqual(endpointsThatWouldClear([a, b], [A]), ["fix.example.net:(no port)", "(no host):9443"]);
});

test("5.2 N1: a live host with a leading space matches the trimmed submission (key on the trimmed value)", () => {
  const before = live({ endpointHost: " fix.example.net", endpointVerified: true });
  assert.deepEqual(endpointsThatWouldClear([before], [A]), []);
  assert.deepEqual(carryVerification([before], [A]).map((r) => r.endpointVerified), [true]);
});

/* ---------- 5.3 parseEndpointsJson ---------- */

test("5.3 null, empty and whitespace raw parse to zero rows", () => {
  assert.deepEqual(parseEndpointsJson(null), []);
  assert.deepEqual(parseEndpointsJson(""), []);
  assert.deepEqual(parseEndpointsJson("   "), []);
  assert.deepEqual(parseEndpointsJson("[]"), []);
});

test("5.3 drops all-blank rows and assigns positions 0..n-1 in source order", () => {
  const raw = JSON.stringify([
    { protocol: "", endpointHost: "", endpointPort: "", compid: "", notes: "" },
    { protocol: " FIX 4.4 ", endpointHost: " a.example.net ", endpointPort: " 9443 ", compid: " C1 ", notes: " BJF " },
    {},
    { endpointHost: "b.example.net", endpointPort: "7000" },
  ]);
  const out = parseEndpointsJson(raw);
  assert.deepEqual(out, [
    { position: 0, protocol: "FIX 4.4", endpointHost: "a.example.net", endpointPort: "9443", compid: "C1", notes: "BJF" },
    { position: 1, protocol: null, endpointHost: "b.example.net", endpointPort: "7000", compid: null, notes: null },
  ]);
});

test("5.3 rejects 9 rows, accepts 8 (cap mirrors the DB check position between 0 and 7)", () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ endpointHost: `h${i}.example.net`, endpointPort: "1" }));
  assert.equal(MAX_ENDPOINTS_PER_PARENT, 8);
  assert.equal(parseEndpointsJson(JSON.stringify(eight)).length, 8);
  const nine = [...eight, { endpointHost: "h8.example.net", endpointPort: "1" }];
  assert.throws(() => parseEndpointsJson(JSON.stringify(nine)), /8/);
});

test("5.3 rejects a row with only notes set", () => {
  assert.throws(() => parseEndpointsJson(JSON.stringify([{ notes: "just a note" }])), /notes/i);
});

test("5.3 rejects host without port, naming Endpoint port", () => {
  assert.throws(
    () => parseEndpointsJson(JSON.stringify([{ endpointHost: "a.example.net" }])),
    (e: unknown) => e instanceof Error && /Endpoint port/.test(e.message) && !/Endpoint host/.test(e.message)
  );
});

test("5.3 rejects port without host, naming Endpoint host", () => {
  assert.throws(
    () => parseEndpointsJson(JSON.stringify([{ endpointPort: "9443", compid: "C1" }])),
    (e: unknown) => e instanceof Error && /Endpoint host/.test(e.message) && !/Endpoint port/.test(e.message)
  );
});

test("5.3 rejects protocol or compid alone (an endpoint row requires host AND port), naming both", () => {
  assert.throws(
    () => parseEndpointsJson(JSON.stringify([{ protocol: "FIX 4.4", compid: "C1" }])),
    (e: unknown) => e instanceof Error && /Endpoint host/.test(e.message) && /Endpoint port/.test(e.message)
  );
});

test("5.3 the error names the row by its 1-based source index, blanks included", () => {
  const raw = JSON.stringify([{}, { endpointHost: "a.example.net" }]);
  assert.throws(() => parseEndpointsJson(raw), /row 2/i);
});

test("5.3 N1: two rows with the same four (notes aside) are refused, naming both rows (fable m54051 via marcus m54053)", () => {
  const raw = JSON.stringify([
    { protocol: "FIX 4.4", endpointHost: "a.example.net", endpointPort: "9443", compid: "C1", notes: "one" },
    { protocol: "FIX 4.4", endpointHost: "a.example.net", endpointPort: "9443", compid: "C1", notes: "two" },
  ]);
  assert.throws(() => parseEndpointsJson(raw), /row 2 repeats row 1/i);
  // Different compid at the same address is a different identity: allowed.
  const distinct = JSON.stringify([
    { protocol: "FIX 4.4", endpointHost: "a.example.net", endpointPort: "9443", compid: "C1" },
    { protocol: "FIX 4.4", endpointHost: "a.example.net", endpointPort: "9443", compid: "C2" },
  ]);
  assert.equal(parseEndpointsJson(distinct).length, 2);
});

test("5.3 non-array JSON and malformed JSON are refused readably", () => {
  assert.throws(() => parseEndpointsJson("{}"), /list/i);
  assert.throws(() => parseEndpointsJson("not json"), /endpoints/i);
  assert.throws(() => parseEndpointsJson("[1]"), /row 1/i);
});

/* ---------- delta 2: parentMirror, the dual-write's position-0 rule (design 3 step 2) ---------- */

test("mirror: zero rows -> all four null and endpoint_verified false (design 3 step 2, :205-206)", () => {
  assert.deepEqual(parentMirror([]), {
    protocol: null,
    endpointHost: null,
    endpointPort: null,
    compid: null,
    endpointVerified: false,
  });
});

test("mirror: the row at position 0 wins whatever the array order (listed second here), and its verified flag rides with it", () => {
  // marcus m54075 item (1)/(2): the earlier form of this test fed two rows both at position 0
  // and went red (40/41 on his box); a set never holds two rows at one position (unique
  // (parent, position), 0091 .sql :123, :147), so the fixture was wrong, not the rule.
  const p1 = live({ ...B, position: 1, endpointVerified: true });
  const p0 = live({ ...A, position: 0, endpointVerified: false });
  assert.deepEqual(parentMirror([p1, p0]), {
    protocol: A.protocol,
    endpointHost: A.endpointHost,
    endpointPort: A.endpointPort,
    compid: A.compid,
    endpointVerified: false,
  });
  assert.equal(parentMirror([p1, live({ ...A, position: 0, endpointVerified: true })]).endpointVerified, true);
});

test("mirror: proposal rows carry no flag, so the proposal-side mirror reads false without inventing one", () => {
  assert.equal(parentMirror([A, B]).endpointVerified, false);
  assert.equal(parentMirror([A, B]).endpointHost, A.endpointHost);
});

test("mirror A2: rows at positions 1 and 2 only (coxwell SQL, no 0) -> all four null and false, as the 0092 gate would compare", () => {
  // fable m54043 via marcus m54049, A2: "position-0 row" is the row whose position === 0, not
  // index 0 of the ordered array.
  const p1 = live({ ...A, position: 1, endpointVerified: true });
  const p2 = live({ ...B, position: 2, endpointVerified: true });
  assert.deepEqual(parentMirror([p1, p2]), {
    protocol: null,
    endpointHost: null,
    endpointPort: null,
    compid: null,
    endpointVerified: false,
  });
});

/* ---------- delta 2: the reader's row -> Map fold, pure (fable J2(iii) via marcus m54049) ---------- */

test("fold: every requested id gets an entry, an empty list for a parent with no rows, rows kept in given order", () => {
  const out = foldEndpointRows(
    ["tier-x", "tier-y"],
    [
      { parentId: "tier-x", endpoint: A },
      { parentId: "tier-x", endpoint: B },
    ]
  );
  assert.deepEqual(Array.from(out.keys()), ["tier-x", "tier-y"]);
  assert.deepEqual(out.get("tier-x"), [A, B]);
  assert.deepEqual(out.get("tier-y"), []);
});

test("fold: a row for an id that was not requested is dropped, not invented as an entry", () => {
  const out = foldEndpointRows(["tier-x"], [{ parentId: "tier-z", endpoint: A }]);
  assert.deepEqual(Array.from(out.entries()), [["tier-x", []]]);
});

/* ---------- 5.4 resolveEndpointsForDisplay, the roster's ConnectionFields shape (delta 3) ---------- */

const APP = { protocol: "FIX 4.2", host: "app.example.net", port: "443", compid: "APPCOMP" };

test("5.4 zero tier rows -> the application's address as ONE fallback entry, verified withheld (null), notes none", () => {
  assert.deepEqual(resolveEndpointsForDisplay([], APP), [
    {
      position: null,
      protocol: "FIX 4.2",
      endpointHost: "app.example.net",
      endpointPort: "443",
      compid: "APPCOMP",
      notes: null,
      endpointVerified: null,
      fromApplication: true,
    },
  ]);
});

test("5.4 one or more tier rows -> the list in position order, nothing from the application, each row's own verified flag and notes", () => {
  const b = live({ ...B, notes: "SBE session", endpointVerified: true });
  const a = live({ ...A, endpointVerified: false });
  const out = resolveEndpointsForDisplay([b, a], APP);
  assert.deepEqual(
    out.map((e) => [e.position, e.endpointHost, e.endpointVerified, e.notes, e.fromApplication]),
    [
      [0, A.endpointHost, false, null, false],
      [1, B.endpointHost, true, "SBE session", false],
    ]
  );
  assert.equal(out.some((e) => e.endpointHost === APP.host || e.compid === APP.compid), false);
});

test("5.4 no mixing: a tier row with protocol and compid null keeps them null although the application has both", () => {
  const out = resolveEndpointsForDisplay([live({ ...C, protocol: null, compid: null })], APP);
  assert.equal(out.length, 1);
  assert.equal(out[0].protocol, null);
  assert.equal(out[0].compid, null);
  assert.equal(out[0].fromApplication, false);
});

test("5.4 zero tier rows and a blank application (null and '' mixed) -> [] and never a half-empty entry", () => {
  assert.deepEqual(resolveEndpointsForDisplay([], { protocol: null, host: "", port: " ", compid: null }), []);
});

test("5.4 fallback treats '' as absent per field (register-provider posts blanks as ''), the rest verbatim", () => {
  const out = resolveEndpointsForDisplay([], { protocol: "", host: "app.example.net", port: "", compid: null });
  assert.deepEqual(out.map((e) => [e.protocol, e.endpointHost, e.endpointPort, e.compid, e.fromApplication]), [
    [null, "app.example.net", null, null, true],
  ]);
});

/* ---------- 5.5 reader assert [S3] ---------- */

test("5.5 a viewer who is neither admin nor the owning provider is refused before any query", () => {
  assert.equal(endpointViewerAllowed({ userId: "u-buyer", isAdmin: false }, "u-owner"), false);
  assert.throws(() => assertEndpointViewer({ userId: "u-buyer", isAdmin: false }, "u-owner"), EndpointViewerError);
});

test("5.5 the owning provider proceeds", () => {
  assert.equal(endpointViewerAllowed({ userId: "u-owner", isAdmin: false }, "u-owner"), true);
  assert.doesNotThrow(() => assertEndpointViewer({ userId: "u-owner", isAdmin: false }, "u-owner"));
});

test("5.5 an admin proceeds", () => {
  assert.equal(endpointViewerAllowed({ userId: "u-admin", isAdmin: true }, "u-owner"), true);
  assert.doesNotThrow(() => assertEndpointViewer({ userId: "u-admin", isAdmin: true }, "u-owner"));
});

test("5.5 a parent with no owner (user_id null) admits only an admin; a null viewer id never matches", () => {
  assert.equal(endpointViewerAllowed({ userId: "u-x", isAdmin: false }, null), false);
  assert.equal(endpointViewerAllowed({ userId: null, isAdmin: false }, null), false);
  assert.equal(endpointViewerAllowed({ userId: null, isAdmin: true }, null), true);
});
