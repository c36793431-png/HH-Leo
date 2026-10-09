/* Run: npx tsx --test src/lib/post-auth-redirect.test.ts
 *
 * /community as a sign-in return path (marcus m62918): honoured on the portal host, exactly, and
 * only there. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { authPageHref, safeCallbackPath } from "./post-auth-redirect";

const PORTAL = "portal.horizonhft.com";

test("/community is a sign-in return path on the portal host", () => {
  assert.equal(safeCallbackPath("/community", PORTAL), "/community");
  assert.equal(authPageHref("/login", "/community"), "/login?callbackUrl=%2Fcommunity");
});

test("only the exact path: no sub-path, no query, no other host", () => {
  for (const value of ["/community/", "/community/x", "/community?x=1", "//community", "/Community"]) {
    assert.equal(safeCallbackPath(value, PORTAL), null, value);
  }
  assert.equal(safeCallbackPath("/community", "feed.horizonhft.com"), null);
  assert.equal(safeCallbackPath("/community", "partner.horizonhft.com"), null);
});

test("the existing return paths are unchanged", () => {
  for (const value of ["/marketplace", "/marketplace/basket", "/education", "/education/obi"]) {
    assert.equal(safeCallbackPath(value, PORTAL), value);
  }
  assert.equal(safeCallbackPath("/education/advanced", PORTAL), null);
  assert.equal(safeCallbackPath("/dashboard", PORTAL), null);
});
