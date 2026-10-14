/* Run: npx tsx --test src/lib/consult-host.test.ts
 *
 * consult.horizonhft.com routing (scope kai m69020, rulings marcus m69004, Fable m69076 ask 4 + S5): "/" renders
 * the apply page, the page and static files pass, every other path goes to the portal at the same path and query. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PORTAL_ORIGIN } from "./feed-host-admin";
import { CONSULT_APPLY_PATH, CONSULT_HOST, consultRoute, isConsultHost } from "./consult-host";

test("the host matches with and without a port, in any case, and nothing else does", () => {
  assert.equal(isConsultHost(CONSULT_HOST), true);
  assert.equal(isConsultHost(`${CONSULT_HOST}:443`), true);
  assert.equal(isConsultHost("Consult.HorizonHFT.com"), true);
  for (const host of ["portal.horizonhft.com", "horizonone.horizonhft.com", "consult.horizonhft.com.evil.com", "xconsult.horizonhft.com", "localhost:3000", ""]) {
    assert.equal(isConsultHost(host), false, host);
  }
  assert.equal(isConsultHost(null), false);
});

test("the root renders the apply page; the page itself passes", () => {
  assert.deepEqual(consultRoute("/", ""), { kind: "rewrite", to: CONSULT_APPLY_PATH });
  assert.deepEqual(consultRoute("/", "?a=1"), { kind: "rewrite", to: CONSULT_APPLY_PATH });
  assert.deepEqual(consultRoute(CONSULT_APPLY_PATH, ""), { kind: "pass" });
});

test("static files pass", () => {
  for (const path of ["/favicon.ico", "/logo.png", "/brand/horizon-logo-paid.png"]) {
    assert.deepEqual(consultRoute(path, ""), { kind: "pass" }, path);
  }
});

test("every other path goes to the portal at the same path and query: /admin (ruling 1), /login, /adminx, /consult/apply/x", () => {
  for (const path of ["/admin", "/admin/consult-applications", "/adminx", "/login", "/signup", "/dashboard", "/marketplace", "/consult", "/consult/apply/x", "/consult/applyx"]) {
    assert.deepEqual(consultRoute(path, "?a=1"), { kind: "redirect", to: `${PORTAL_ORIGIN}${path}?a=1` }, path);
  }
  assert.deepEqual(consultRoute("/login", ""), { kind: "redirect", to: `${PORTAL_ORIGIN}/login` });
});

test("the redirect target is always the portal origin (no open redirect)", () => {
  for (const path of ["//evil.com", "/\\evil.com", "/@evil.com"]) {
    const r = consultRoute(path, "");
    assert.equal(r.kind, "redirect", path);
    if (r.kind === "redirect") assert.equal(new URL(r.to).origin, PORTAL_ORIGIN, path);
  }
});
