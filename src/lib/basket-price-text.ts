import type { BasketLineKind } from "./basket-catalogue";

/** Plain module (no "use client"), so the basket view and its test both call the same function. */

export const BY_AGREEMENT = "Priced by agreement";

/** What a basket line's price slot says, on all three steps. Only a bundle can carry a price, and only signed in:
 * `bundlePrices` holds the server's string per bundle key (portal_config, read inside `if (user)`), never a number
 * computed here. Signed out, `priceAfterSignIn` says a price exists without carrying it (Fable S2 C6). Everything
 * else, and any bundle with no price row, is priced by agreement. */
export function linePriceText(
  line: { kind: BasketLineKind; key: string },
  bundlePrices: Record<string, string> | undefined,
  priceAfterSignIn: boolean | undefined,
): string {
  if (line.kind !== "bundle") return BY_AGREEMENT;
  const price = bundlePrices?.[line.key];
  if (price) return price;
  return priceAfterSignIn ? "Price shown after sign-in" : BY_AGREEMENT;
}
