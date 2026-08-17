// Static leaderboard from FOC13's 51h feed analysis (2026-08-16), authoritative per marcus.
// Sub-component (Speed/Consistency/Stream) splits are only confirmed for Black, Alpha's
// stream figure, Delta, and Epsilon — see notes. Do not invent splits for the rest.
export type FeedScoreEntry = {
  rank: number;
  name: string;
  score: number;
  speed: number; // /45
  consistency: number; // /35
  streamQuality: number; // /20
  estimatedSplit?: boolean; // true if speed/consistency/streamQuality are proportional estimates, not confirmed sub-scores
  note?: string;
};

const SPEED_MAX = 45;
const CONSISTENCY_MAX = 35;
const STREAM_MAX = 20;

function estimatedSplit(score: number): Pick<FeedScoreEntry, "speed" | "consistency" | "streamQuality"> {
  return {
    speed: Number(((score * SPEED_MAX) / 100).toFixed(1)),
    consistency: Number(((score * CONSISTENCY_MAX) / 100).toFixed(1)),
    streamQuality: Number(((score * STREAM_MAX) / 100).toFixed(1)),
  };
}

export const FEED_COMPARISON_SCORES: FeedScoreEntry[] = [
  { rank: 1, name: "Black", score: 94.8, speed: 45, consistency: 35, streamQuality: 14.8 },
  {
    rank: 2,
    name: "Alpha",
    score: 76.4,
    speed: 34.4,
    consistency: 26.8,
    streamQuality: 15.2,
  },
  { rank: 3, name: "Ultra", score: 73.2, ...estimatedSplit(73.2), estimatedSplit: true },
  { rank: 4, name: "Beta", score: 42.4, ...estimatedSplit(42.4), estimatedSplit: true },
  { rank: 5, name: "Gamma", score: 14.5, ...estimatedSplit(14.5), estimatedSplit: true },
  {
    rank: 6,
    name: "Delta",
    score: 6.0,
    speed: 0,
    consistency: 0,
    streamQuality: 6.0,
    note: "Stream quality only — identical spread/gaps to Gamma, ~1.8ms slower.",
  },
  {
    rank: 7,
    name: "Epsilon",
    score: 0.0,
    speed: 0,
    consistency: 0,
    streamQuality: 0,
    note: "Offline — 3 ticks in 51 hours.",
  },
];
