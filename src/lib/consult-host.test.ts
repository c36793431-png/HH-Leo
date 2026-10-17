/* Run: npx tsx --test src/lib/consult-host.test.ts
 *
 * consult.horizonhft.com routing (scope kai m69020, rulings marcus m69004, Fable m69076 ask 4 + S5): "/" renders
 * the apply page, the page and static files pass, every other path goes to the portal at the same path and query. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PORTAL_ORIGIN } from "./feed-host-admin";
import { CONSULT_APPLY_PATH, CONSULT_HOST, CONSULT_ORIGIN, consultApplyRedirect, consultRoute, isConsultHost } from "./consult-host";

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
  // A dotted path under /admin is not a static file: it 307s before the static rule (ruling 1, Fable S1 m69219).
  assert.deepEqual(consultRoute("/admin/x.json", ""), { kind: "redirect", to: `${PORTAL_ORIGIN}/admin/x.json` });
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
    assert.notEqual(r.kind, "rewrite", path);
    if (r.kind === "redirect") assert.equal(new URL(r.to).origin, PORTAL_ORIGIN, path);
  }
});

/* S1b (marcus m71322): consult.horizonhft.com is the entry point, so the portal's /consult/apply 308s there. Only on a
 * horizonhft.com host other than the consult host itself (never a loop); previews and local dev keep the page. */
test("S1b: /consult/apply on a horizonhft.com host 308s to the consult host root", () => {
  for (const host of ["portal.horizonhft.com", "portal.horizonhft.com:443", "Portal.HorizonHFT.com", "feed.horizonhft.com", "partner.horizonhft.com", "horizonone.horizonhft.com"]) {
    assert.equal(consultApplyRedirect(host, CONSULT_APPLY_PATH), CONSULT_ORIGIN + "/", host);
  }
  assert.equal(CONSULT_ORIGIN, `https://${CONSULT_HOST}`);
});

test("S1b: never on the consult host (no loop), never on previews or local dev, never for another path", () => {
  for (const host of [CONSULT_HOST, `${CONSULT_HOST}:443`, "Consult.HorizonHFT.com", "hh-leo-git-x.vercel.app", "localhost:3000", "127.0.0.1:3000", "horizonhft.com.evil.com", "evilhorizonhft.com", "", null]) {
    assert.equal(consultApplyRedirect(host, CONSULT_APPLY_PATH), null, String(host));
  }
  for (const path of ["/consult", "/consult/apply/", "/consult/apply/x", "/consult/applyx", "/", "/login"]) {
    assert.equal(consultApplyRedirect("portal.horizonhft.com", path), null, path);
  }
});
