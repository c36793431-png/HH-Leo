import type { BasketLineKind } from "./basket-catalogue";

/** Plain module (no "use client"), so the basket view and its test both call the same function. */

export const BY_AGREEMENT = "Priced by agreement";

/** The phone bar's total while any line is unpriced (coxwell copy OK via marcus m67960 #3). */
export const TOTAL_ON_REPLY = "Confirmed when we reply";

/** The one money format: "$100/month". bundle-price.ts formats the product page's price with it too, so a line,
 * the product page and the total can never disagree on how an amount reads. */
export function formatUsdPerMonth(usd: number): string {
  return `$${usd.toLocaleString("en-US")}/month`;
}

/** A line's amount, or null when it shows no price. Only a bundle can carry one, and only signed in:
 * `bundlePrices` holds the server's whole usd per month per bundle key (portal_config, read inside `if (user)`). */
function lineUsd(line: { kind: BasketLineKind; key: string }, bundlePrices: Record<string, number> | undefined): number | null {
  if (line.kind !== "bundle") return null;
  return bundlePrices?.[line.key] ?? null;
}

/** What a basket line's price slot says, on all three steps. Signed out, `priceAfterSignIn` says a price exists
 * without carrying it (Fable S2 C6). Everything else, and any bundle with no price row, is priced by agreement. */
export function linePriceText(
  line: { kind: BasketLineKind; key: string },
  bundlePrices: Record<string, number> | undefined,
  priceAfterSignIn: boolean | undefined,
): string {
  const usd = lineUsd(line, bundlePrices);
  if (usd !== null) return formatUsdPerMonth(usd);
  return line.kind === "bundle" && priceAfterSignIn ? "Price shown after sign-in" : BY_AGREEMENT;
}

/** The basket's total in usd per month, or null when it has none: the sum when EVERY line shows a price; null when
 * any line is unpriced or the basket is empty. The phone bar and the desktop summary both read it (marcus m67972 #2),
 * so they can't disagree on whether a total exists. Signed out no line carries an amount, so this is always null
 * there (C6). Today only a bundle can be priced and a basket holds one bundle (basket-catalogue C4), so the one
 * priced case is a lone bundle. */
export function basketTotalUsd(lines: { kind: BasketLineKind; key: string }[], bundlePrices: Record<string, number> | undefined): number | null {
  const amounts = lines.map((l) => lineUsd(l, bundlePrices));
  if (amounts.length === 0 || amounts.some((a) => a === null)) return null;
  return (amounts as number[]).reduce((sum, a) => sum + a, 0);
}

/** The phone sticky bar's total (marcus m67960 #3): basketTotalUsd as "$100/month", else TOTAL_ON_REPLY. */
export function basketTotalText(lines: { kind: BasketLineKind; key: string }[], bundlePrices: Record<string, number> | undefined): string {
  const usd = basketTotalUsd(lines, bundlePrices);
  return usd === null ? TOTAL_ON_REPLY : formatUsdPerMonth(usd);
}
