import { pool } from "./db";
import type { BundleKey } from "./bundle-catalogue";
import { formatUsdPerMonth } from "./basket-price-text";

/** A bundle's list price, the ONE price the portal shows (coxwell Q-I m66858 "$100/month"; marcus M0 m67867):
 * signed-in only, at the purchase steps (the product page's Access box and the three basket steps). Member tiers
 * are shown by name only, never priced.
 *
 * SERVER ONLY. No "use client" file may import this module (pinned by bundle-s2.test.ts; the repo has no
 * server-only package, so that pin is the guard). A page reads it inside `if (user)` and passes the string as its
 * own prop, never on a catalogue entry, because the catalogue prop also reaches signed-out RSC payloads.
 *
 * DATA, not code: portal_config `bundle_list_price` = {"horizon-complete": {"usd": 100, "per": "month"}}, which
 * marcus applies. NO FALLBACK NUMBER (unlike paid_tier_default_price_usd, licenses.ts): a missing row, an unknown
 * key, a usd that is not a positive whole number, or a per other than "month" reads as null, and every surface
 * then says "Priced by agreement". The same refuse-don't-guess shape as bundles.ts feedShareCents. */

export const BUNDLE_LIST_PRICE_CONFIG_KEY = "bundle_list_price";

/** One bundle's whole usd per month, from the config value as stored. Null = show no price. */
export function bundleListPriceUsd(value: unknown, key: BundleKey): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = (value as Record<string, unknown>)[key];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const { usd, per } = entry as { usd?: unknown; per?: unknown };
  if (typeof usd !== "number" || !Number.isSafeInteger(usd) || usd <= 0) return null;
  if (per !== "month") return null;
  return usd;
}

/** The display string for one bundle, from the config value as stored. Null = show no price. */
export function formatBundleListPrice(value: unknown, key: BundleKey): string | null {
  const usd = bundleListPriceUsd(value, key);
  return usd === null ? null : formatUsdPerMonth(usd);
}

/** The config value as stored, or null. A failed read is null too: every surface then shows "Priced by
 * agreement", never a guess. */
async function readBundleListPriceConfig(): Promise<unknown> {
  try {
    const r = await pool.query<{ value: unknown }>(`select value from portal_config where key = $1`, [BUNDLE_LIST_PRICE_CONFIG_KEY]);
    return r.rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

/** "$100/month", or null: the product page's Access box. */
export async function getBundleListPrice(key: BundleKey): Promise<string | null> {
  return formatBundleListPrice(await readBundleListPriceConfig(), key);
}

/** Every bundle's whole usd per month, for the basket's three signed-in steps and the phone bar's total (the
 * total is a sum, so the basket gets numbers; basket-price-text.ts formats them). Keys with no price are left out. */
export async function getBundleListPrices(keys: BundleKey[]): Promise<Record<string, number>> {
  const value = await readBundleListPriceConfig();
  const out: Record<string, number> = {};
  for (const key of keys) {
    const usd = bundleListPriceUsd(value, key);
    if (usd !== null) out[key] = usd;
  }
  return out;
}
