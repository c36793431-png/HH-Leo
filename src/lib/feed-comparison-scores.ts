// Static leaderboard; scores per coxwell ruling 2026-10-02; public label = "Measured Fri 14 Aug
// 2026, 11:57–21:00 UTC (9 market-open hours, XAUUSD)", the same everywhere it is shown.
// Speed/Consistency/Stream parts are FOC13's, computed from the inputs behind the ruled totals
// (feed-methodology-draft.md §2, marcus m59293): one decimal, largest-remainder, so each row
// sums to its score.
export type FeedScoreEntry = {
  rank: number;
  name: string;
  score: number;
  speed: number; // /45
  consistency: number; // /35
  streamQuality: number; // /20
  note?: string;
};

export const FEED_COMPARISON_SCORES: FeedScoreEntry[] = [
  { rank: 1, name: "Black", score: 94.8, speed: 45, consistency: 35, streamQuality: 14.8 },
  { rank: 2, name: "Alpha", score: 76.4, speed: 35.7, consistency: 25.5, streamQuality: 15.2 },
  { rank: 3, name: "Ultra", score: 73.2, speed: 35.1, consistency: 24.9, streamQuality: 13.2 },
  { rank: 4, name: "Beta", score: 42.4, speed: 14.8, consistency: 14.4, streamQuality: 13.2 },
  { rank: 5, name: "Gamma", score: 14.5, speed: 0.9, consistency: 7.6, streamQuality: 6.0 },
  {
    rank: 6,
    name: "Delta",
    score: 6.0,
    speed: 0,
    consistency: 0,
    streamQuality: 6.0,
    note: "Stream quality only — identical spread/gaps to Gamma, ~1.8ms slower.",
  },
  // No seventh row: FOC13's methodology doesn't show the seventh feed (marcus m59548).
];

/** tier_key -> FEED_COMPARISON_SCORES entry name, for London's score tiers plus the
 * standalone Black flagship. Keyed by tier_key rather than feed_tiers.name (marcus,
 * leo-london-tier-score-mismatch-2026-09-07) — 0074 only short-formed Alpha/Ultra's name,
 * so a name-string match would silently miss Beta/Gamma/Delta. Single source for every
 * surface that needs London's canonical score by tier_key (feeds/[region]/tiers page,
 * formatTierLatency, getBestLatencyByRegion) so it can't drift a third time. Exported for the
 * marketplace product pages, which highlight their own rows by it (marcus, m52875). */
export const SCORE_TIER_NAMES: Record<string, string> = {
  "ld-alpha-85": "Alpha",
  "ld-beta-56": "Beta",
  "ld-gamma-19": "Gamma",
  "ld-delta-18": "Delta",
  "ld-ultra": "Ultra",
  black: "Black",
};

export function scoreForTierKey(tierKey: string): number | null {
  const name = SCORE_TIER_NAMES[tierKey];
  const entry = name ? FEED_COMPARISON_SCORES.find((f) => f.name === name) : undefined;
  return entry ? entry.score : null;
}

/** The FEED_COMPARISON_SCORES names of the tier_keys that have a score, in leaderboard order.
 * Empty = none of them is on the board (NY, Chicago, the terminal). */
export function scoreNamesForTierKeys(tierKeys: string[]): string[] {
  const names = new Set(tierKeys.map((k) => SCORE_TIER_NAMES[k]).filter(Boolean));
  return FEED_COMPARISON_SCORES.filter((f) => names.has(f.name)).map((f) => f.name);
}
