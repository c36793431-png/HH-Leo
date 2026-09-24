/* Run: npx tsx --test src/lib/tier-request-state.test.ts
 *
 * The repo has no test runner; node:test via tsx needs nothing installed. Pure function only --
 * the SQL reader behind liveGrants is exercised against prod read-only, not here. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveTierRequestStates } from "./tier-request-state";

const BASE = ["ld-beta-56", "ld-gamma-19", "ld-delta-18"];
const OCT_19 = new Date("2026-10-19T17:12:35.462Z");

test("a direct-granted Base holder with zero envelopes reads granted, with the licence's end date", () => {
  // @aylrn09's shape on 2026-09-24 (marcus m53583/m53589): three live admin grants on licence
  // CHFP, access_request_id NULL, so no access_requests envelope at all.
  const states = deriveTierRequestStates(
    [],
    BASE.map((tierKey) => ({ tierKey, regionKey: "london", liveUntil: OCT_19 })),
    "london"
  );
  for (const k of BASE) {
    assert.deepEqual(states.get(k), { state: "granted", grantedUntil: OCT_19 }, k);
  }
});

test("a live grant outranks a pending envelope on the same tier", () => {
  const states = deriveTierRequestStates(
    [{ region: "london", tierKey: "ld-beta-56", status: "pending" }],
    [{ tierKey: "ld-beta-56", regionKey: "london", liveUntil: OCT_19 }],
    "london"
  );
  assert.deepEqual(states.get("ld-beta-56"), { state: "granted", grantedUntil: OCT_19 });
});

test("an approved envelope with no live grant still reads granted, with no date to show", () => {
  const states = deriveTierRequestStates(
    [{ region: "london", tierKey: "ld-beta-56", status: "approved" }],
    [],
    "london"
  );
  assert.deepEqual(states.get("ld-beta-56"), { state: "granted", grantedUntil: null });
});

test("two live grants on one tier: the tier is held until the later one ends", () => {
  const earlier = new Date("2026-10-01T00:00:00Z");
  const states = deriveTierRequestStates(
    [],
    [
      { tierKey: "ld-beta-56", regionKey: "london", liveUntil: earlier },
      { tierKey: "ld-beta-56", regionKey: "london", liveUntil: OCT_19 },
    ],
    "london"
  );
  assert.deepEqual(states.get("ld-beta-56"), { state: "granted", grantedUntil: OCT_19 });
});

test("a grant in another region does not speak for this one", () => {
  const states = deriveTierRequestStates(
    [],
    [{ tierKey: "ny-fast", regionKey: "ny", liveUntil: OCT_19 }],
    "london"
  );
  assert.equal(states.get("ny-fast"), undefined);
});

test("rejected and pending envelopes behave exactly as before when no grant exists", () => {
  const states = deriveTierRequestStates(
    [
      { region: "london", tierKey: "ld-beta-56", status: "rejected" },
      { region: "london", tierKey: "ld-gamma-19", status: "pending" },
    ],
    [],
    "london"
  );
  assert.equal(states.get("ld-beta-56"), undefined);
  assert.deepEqual(states.get("ld-gamma-19"), { state: "pending", grantedUntil: null });
});
