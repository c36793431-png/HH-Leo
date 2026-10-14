/* Run: npx tsx --test src/lib/horizonone-host.test.ts
 *
 * horizonone.horizonhft.com routing (plan kai m68750, rulings marcus m68767): the host serves the signals page and
 * sign-in only; every other host 404s the page, except local dev. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { HORIZONONE_HOST, SIGNALS_PATH, horizonOneRoute, isHorizonOneHost, isSignalsPath, signalsServedOn } from "./horizonone-host";

test("the host matches with and without a port, and nothing else does", () => {
  assert.equal(isHorizonOneHost(HORIZONONE_HOST), true);
  assert.equal(isHorizonOneHost(`${HORIZONONE_HOST}:3000`), true);
  for (const host of ["portal.horizonhft.com", "feed.horizonhft.com", "partner.horizonhft.com", "horizonone.horizonhft.com.evil.com", "xhorizonone.horizonhft.com", "localhost:3000", ""]) {
    assert.equal(isHorizonOneHost(host), false, host);
  }
  assert.equal(isHorizonOneHost(null), false);
});

test("the signals path is the page and its subpaths, not a bare prefix", () => {
  assert.equal(isSignalsPath(SIGNALS_PATH), true);
  assert.equal(isSignalsPath(`${SIGNALS_PATH}/EURUSD`), true);
  for (const path of ["/admin/signalsx", "/admin/signal", "/admin", "/signals", "/"]) assert.equal(isSignalsPath(path), false, path);
});

test("only horizonone serves the page in production and on previews; dev serves it on any host", () => {
  assert.equal(signalsServedOn(HORIZONONE_HOST, "production"), true);
  for (const host of ["portal.horizonhft.com", "feed.horizonhft.com", "hh-leo-git-x.vercel.app", null]) {
    assert.equal(signalsServedOn(host, "production"), false, String(host));
  }
  assert.equal(signalsServedOn("localhost:3000", "development"), true);
  // "Not production" is not the bypass (m68767 Q1).
  assert.equal(signalsServedOn("localhost:3000", "test"), false);
  assert.equal(signalsServedOn("localhost:3000", undefined), false);
});

test("the root and the post-sign-in /dashboard go to the page", () => {
  assert.deepEqual(horizonOneRoute("/"), { kind: "redirect", to: SIGNALS_PATH });
  assert.deepEqual(horizonOneRoute("/dashboard"), { kind: "redirect", to: SIGNALS_PATH });
});

test("the page, sign-in and static files pass", () => {
  for (const path of [SIGNALS_PATH, `${SIGNALS_PATH}/EURUSD`, "/login", "/logo.png", "/brand/horizon-logo-paid.png"]) {
    assert.deepEqual(horizonOneRoute(path), { kind: "pass" }, path);
  }
});

test("everything else 404s, other admin pages and signup included", () => {
  for (const path of ["/admin", "/admin/users", "/admin/finance", "/admin/signalsx", "/signup", "/dashboard/x", "/marketplace", "/account", "/feed", "/partner"]) {
    assert.deepEqual(horizonOneRoute(path), { kind: "not-found" }, path);
  }
});
