/* Run: npx tsx --test src/lib/feed-host-admin.test.ts
 *
 * Feed host /admin routing (marcus m63885 / m63907, option A): feed-admin pages stay on the feed host; every other
 * /admin URL goes to the portal at the same path and query; nothing outside /admin is touched. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_FEED_ROUTES, PORTAL_ORIGIN, isAdminFeedRoute, portalAdminRedirect } from "./feed-host-admin";

test("the basket requests page goes to the portal, query kept", () => {
  assert.equal(portalAdminRedirect("/admin/basket-requests", ""), "https://portal.horizonhft.com/admin/basket-requests");
  assert.equal(portalAdminRedirect("/admin/basket-requests", "?id=42"), "https://portal.horizonhft.com/admin/basket-requests?id=42");
});

test("every other portal-only admin page goes to the portal too", () => {
  for (const path of ["/admin/users", "/admin/finance", "/admin/licenses", "/admin/history", "/admin/strategy-requests", "/admin/basket-requests/abc"]) {
    assert.equal(portalAdminRedirect(path, ""), `${PORTAL_ORIGIN}${path}`, path);
  }
});

test("feed-admin pages stay on the feed host", () => {
  for (const path of ADMIN_FEED_ROUTES) assert.equal(portalAdminRedirect(path, ""), null, path);
  assert.equal(portalAdminRedirect("/admin/provider-applications/123", ""), null);
  assert.equal(isAdminFeedRoute("/admin/provider-applications/123"), true);
});

test("the allowlist is exact, not a prefix", () => {
  assert.equal(isAdminFeedRoute("/admin/feed-boxes/x"), false);
  assert.equal(portalAdminRedirect("/admin/feed-boxes/x", ""), `${PORTAL_ORIGIN}/admin/feed-boxes/x`);
});

test("nothing outside /admin is redirected (the provider panel, login, account, assets)", () => {
  for (const path of ["/", "/dashboard", "/feed/dashboard", "/login", "/account/servers", "/administrator", "/admins", "/logo.png"]) {
    assert.equal(portalAdminRedirect(path, ""), null, path);
  }
});
