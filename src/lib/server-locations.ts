/** Fixed vocabulary for /account/servers grouping (marcus, overnight-builds-2026-08-30).
 * Order matches FEED_REGIONS in feed-tier-catalogue.ts (the feeds page): London, New
 * York, Chicago, Tokyo -- every region always renders, including empty ones. */
export type ServerLocation = "london" | "ny" | "cme" | "tokyo";

export const SERVER_LOCATIONS: ServerLocation[] = ["london", "ny", "cme", "tokyo"];

export const SERVER_LOCATION_LABELS: Record<ServerLocation, string> = {
  london: "London",
  ny: "New York",
  cme: "Chicago",
  tokyo: "Tokyo",
};

export function isServerLocation(value: string): value is ServerLocation {
  return (SERVER_LOCATIONS as string[]).includes(value);
}

/** Resolves the group a registration belongs to. Prefers the canonical `location`
 * column; for legacy rows (location null, pre-dating the fixed select) case-folds the
 * free-text `serverLocation` against the canonical labels -- an uncanonical-but-exact
 * match ("london", " London ") still lands in its group (coxwell's own row holds the
 * typed string "London" and must not regress to Unspecified on first render). Anything
 * else ("LDN", "London, UK") falls to "unspecified" and gets fixed on next edit; no
 * synonym table. */
export function effectiveServerLocation(
  location: string | null | undefined,
  serverLocationText: string
): ServerLocation | "unspecified" {
  if (location && isServerLocation(location)) return location;

  const normalized = serverLocationText.trim().toLowerCase();
  const match = SERVER_LOCATIONS.find((loc) => SERVER_LOCATION_LABELS[loc].toLowerCase() === normalized);
  return match ?? "unspecified";
}
