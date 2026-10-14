/* Run: npx tsx --test src/lib/horizonone-host.test.ts
 *
 * horizonone.horizonhft.com routing (plan kai m68750, rulings marcus m68767, fable plan read m68780 S1-S3 folded
 * per marcus m68786): the host serves the signals page only; sign-in and other admin pages go to the portal; every
 * other host 404s the page, except local dev. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PORTAL_ORIGIN } from "./feed-host-admin";
import { HORIZONONE_HOST, SIGNALS_PATH, horizonOneRoute, isHorizonOneHost, isSignalsPath, signalsHostOk } from "./horizonone-host";

test("the host matches with and without a port, in any case, and nothing else does", () => {
  assert.equal(isHorizonOneHost(HORIZONONE_HOST), true);
  assert.equal(isHorizonOneHost(`${HORIZONONE_HOST}:443`), true);
  assert.equal(isHorizonOneHost("HorizonOne.HorizonHFT.com"), true);
  for (const host of ["portal.horizonhft.com", "feed.horizonhft.com", "partner.horizonhft.com", "horizonone.horizonhft.com.evil.com", "xhorizonone.horizonhft.com", "localhost:3000", ""]) {
    assert.equal(isHorizonOneHost(host), false, host);
  }
  assert.equal(isHorizonOneHost(null), false);
});

test("isHorizonOneHost takes no env: localhost is not horizonone, dev or not (fable S2)", () => {
  // One argument by type; a dev process must not see every host as horizonone.
  assert.equal(isHorizonOneHost.length, 1);
  assert.equal(isHorizonOneHost("localhost:3000"), false);
});

test("the signals path is the page and its subpaths, not a bare prefix", () => {
  assert.equal(isSignalsPath(SIGNALS_PATH), true);
  assert.equal(isSignalsPath(`${SIGNALS_PATH}/EURUSD`), true);
  for (const path of ["/admin/signalsx", "/admin/signal", "/admin", "/signals", "/"]) assert.equal(isSignalsPath(path), false, path);
});

test("only horizonone passes signalsHostOk in production and on previews; dev passes any host", () => {
  assert.equal(signalsHostOk(HORIZONONE_HOST, { NODE_ENV: "production" }), true);
  assert.equal(signalsHostOk(`${HORIZONONE_HOST}:443`, { NODE_ENV: "production" }), true);
  for (const host of ["portal.horizonhft.com", "feed.horizonhft.com", "xhorizonone.horizonhft.com", "hh-leo-git-x.vercel.app", null]) {
    assert.equal(signalsHostOk(host, { NODE_ENV: "production" }), false, String(host));
  }
  assert.equal(signalsHostOk("localhost:3000", { NODE_ENV: "development" }), true);
  // "Not production" is not the bypass (m68767 Q1).
  assert.equal(signalsHostOk("localhost:3000", { NODE_ENV: "test" }), false);
  assert.equal(signalsHostOk("localhost:3000", {}), false);
});

test("the root and the post-sign-in /dashboard go to the page", () => {
  assert.deepEqual(horizonOneRoute("/", ""), { kind: "redirect", to: SIGNALS_PATH });
  assert.deepEqual(horizonOneRoute("/dashboard", ""), { kind: "redirect", to: SIGNALS_PATH });
});

test("/login goes to the portal's /login with the query kept (fable S1, marcus m68786 (b))", () => {
  assert.deepEqual(horizonOneRoute("/login", ""), { kind: "redirect", to: `${PORTAL_ORIGIN}/login` });
  assert.deepEqual(horizonOneRoute("/login", "?callbackUrl=%2Fadmin%2Fsignals"), { kind: "redirect", to: `${PORTAL_ORIGIN}/login?callbackUrl=%2Fadmin%2Fsignals` });
});

test("other /admin pages go to the portal at the same path and query (marcus m68786 (c))", () => {
  for (const path of ["/admin", "/admin/users", "/admin/finance", "/admin/signalsx", "/admin/x.json"]) {
    assert.deepEqual(horizonOneRoute(path, "?a=1"), { kind: "redirect", to: `${PORTAL_ORIGIN}${path}?a=1` }, path);
  }
});

test("the page and static files pass", () => {
  for (const path of [SIGNALS_PATH, `${SIGNALS_PATH}/EURUSD`, "/logo.png", "/brand/horizon-logo-paid.png"]) {
    assert.deepEqual(horizonOneRoute(path, ""), { kind: "pass" }, path);
  }
});

test("every other non-admin path 404s, signup included", () => {
  for (const path of ["/signup", "/dashboard/x", "/marketplace", "/account", "/feed", "/partner", "/adminx"]) {
    assert.deepEqual(horizonOneRoute(path, ""), { kind: "not-found" }, path);
  }
});
