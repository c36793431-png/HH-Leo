import type { StrategyKey } from "./setfiles";

export type EducationCategoryKey =
  | "getting-started"
  | "connecting-brokers"
  | "strategy-deep-dives"
  | "troubleshooting"
  | "advanced";

export type EducationCategory = {
  key: EducationCategoryKey;
  label: string;
  subtitle: string;
};

export const EDUCATION_CATEGORIES: EducationCategory[] = [
  { key: "getting-started", label: "Getting Started", subtitle: "Set up the terminal and place your first trade" },
  { key: "connecting-brokers", label: "Connecting Brokers", subtitle: "Link accounts and tune your broker connections" },
  { key: "strategy-deep-dives", label: "Strategy Deep-Dives", subtitle: "Build and refine trading strategies" },
  { key: "troubleshooting", label: "Troubleshooting", subtitle: "Diagnose and resolve common issues" },
  { key: "advanced", label: "Advanced", subtitle: "Signal construction and execution at scale" },
];

export type EducationBlockType = "info" | "setting" | "warning" | "blocked";

export type EducationBlock = {
  type: EducationBlockType;
  heading: string;
  body: string;
  items?: string[];
};

export type EducationLesson = {
  slug: string;
  title: string;
  description: string;
  category: EducationCategoryKey;
  minutes: number;
  free: boolean;
  /** Manual section number, 1-12, per the Horizon HFT User Tutorial v1.91. */
  section: number;
  /** Title/description for the public catalogue (publicEducationCatalogue), where they differ from
   * the signed-in portal's. Set only where the portal copy carries a do-not-publish term. */
  publicTitle?: string;
  publicDescription?: string;
  /** Intro for the signed-out lesson page (education-signed-out.ts), where the member intro carries
   * a do-not-publish term (marcus, m62833). */
  publicIntro?: string;
  /** Single intro paragraph — shown on locked cards and as the opener on full lessons. */
  intro: string;
  /** The strategy this lesson teaches: its marketplace card diagram heads the lesson (m62840). */
  strategy?: StrategyKey;
  blocks: EducationBlock[];
};

export const EDUCATION_MANUAL_VERSION = "v1.91";
export const EDUCATION_MANUAL_TOTAL_SECTIONS = 12;

export const EDUCATION_LESSONS: EducationLesson[] = [
  {
    slug: "getting-started",
    title: "Getting Started",
    description: "Activate your license, understand the hardware lock, and complete your first run.",
    category: "getting-started",
    minutes: 5,
    free: true,
    section: 1,
    intro:
      "Activate your Horizon HFT terminal in minutes — from license entry to your very first launch.",
    blocks: [
      {
        type: "info",
        heading: "Your License Key",
        body:
          "Your license key looks like HHFT-XXXXXX-XXXXXX-XXXXXX. On first launch, paste it into the LICENSE KEY box and press ACTIVATE LICENSE; the terminal checks it online and opens.",
      },
      {
        type: "setting",
        heading: "Hardware Lock",
        body:
          "Each license binds to the hardware fingerprint of the first machine that activates it. Reinstalling on a new machine requires a reset from support — plan your rollout accordingly.",
      },
      {
        type: "info",
        heading: "First-Run Flow",
        body:
          "First launch asks for your license key, then opens the main window. Connect your broker and your fast feed in ⚙ Connections, choose a strategy in the STRATEGY panel, and press START TRADING once the Feed and Broker dots in the header are lit.",
      },
    ],
  },
  {
    slug: "interface",
    title: "Interface",
    description: "Tour the tab layout: settings on the left, live data and charts in the middle, the Trade Log on the right.",
    category: "getting-started",
    minutes: 6,
    free: true,
    section: 2,
    intro: "Get oriented with Horizon's layout before you touch a single setting.",
    blocks: [
      {
        type: "info",
        heading: "Tab Layout",
        body:
          "Each tab has three columns. On the left, the STRATEGY panel holds every setting and the START TRADING button. In the middle, DATAFEED ANALYSE compares the fast feed with your broker, above the price and gap charts and the session figures. On the right, the TRADE LOG records everything the tab does. Broker and feed connections are set in the ⚙ Connections window in the header.",
      },
      {
        type: "setting",
        heading: "Multi-Tab Workspaces",
        body:
          "Each tab runs on its own: its own strategy, broker and feed connections, and settings. Add a tab with the + after the last one, and double-click a tab to rename it. Tabs on the same broker login share one broker session, so disconnecting one tab leaves it open for the others.",
      },
    ],
  },
  {
    slug: "broker-connections",
    title: "Broker Connections",
    description: "MT5 Manager API, MT4, and Rithmic — what's supported and where the caveats are.",
    category: "connecting-brokers",
    minutes: 8,
    free: true,
    section: 3,
    intro:
      "Horizon connects to your broker through one of three supported paths — pick the one that matches your infrastructure.",
    blocks: [
      {
        type: "info",
        heading: "MT5 Manager API (Recommended)",
        body:
          "The MT5 Manager API is the primary, best-supported connection path and the one we recommend for new setups.",
      },
      {
        type: "setting",
        heading: "MT4 Support",
        body: "MT4 is supported as a secondary path for brokers who haven't migrated to MT5.",
      },
      {
        type: "warning",
        heading: "Rithmic Caveats",
        body:
          "Rithmic connections only support 1 Leg, Trend Impulse, and OBI strategies. Grid Arbitrage and 2 Leg Lock are NOT available over Rithmic — plan your strategy selection around your broker.",
      },
    ],
  },
  {
    slug: "fast-feed",
    title: "Fast Feed",
    description: "What Fast Feed is, and why it gives you a data advantage.",
    category: "connecting-brokers",
    minutes: 7,
    free: true,
    section: 4,
    intro:
      "Fast Feed is Horizon's low-latency market data path — the foundation every latency-sensitive strategy depends on.",
    blocks: [
      {
        type: "info",
        heading: "What It Is",
        body:
          "Fast Feed is a dedicated, low-latency data connection that runs alongside your broker feed, giving the terminal an early look at price moves.",
      },
      {
        type: "setting",
        heading: "Why the Data Advantage Matters",
        body:
          "Strategies like 1 Leg, Trend Impulse, and OBI compare Fast Feed prices against your broker's slower feed — the gap between the two is where the edge lives.",
      },
    ],
  },
  {
    slug: "1-leg-latency-arb",
    title: "1 Leg (Latency Arb)",
    description: "Trade the gap between Fast Feed and your broker feed as it opens.",
    category: "strategy-deep-dives",
    minutes: 12,
    free: true,
    section: 5,
    strategy: "1leg",
    intro: "1 Leg trades the gap between Fast Feed and your broker feed the moment a price discrepancy opens up.",
    blocks: [
      {
        type: "setting",
        heading: "Core Parameters",
        body: "Tune these six parameters to shape entry sensitivity and risk:",
        items: [
          "Exec Gap — the lead, in points, the fast feed needs over your broker to open a trade: fast bid above broker ask for BUY, broker bid above fast ask for SELL",
          "Shift — a fixed offset, in points, applied to that comparison; a positive Shift makes BUY entries need a bigger lead and SELL entries a smaller one",
          "Stop Loss / Take Profit — distances from the entry, in points",
          "Max Spread — no new entry while your broker's spread is wider than this, in points",
          "Trade Pause — seconds to wait after a trade closes, or after your broker rejects an order, before the next entry",
        ],
      },
    ],
  },
  {
    slug: "2-leg-lock-hedge-arb",
    title: "2 Leg Lock (Hedge Arb)",
    description: "Hedge-based arbitrage that re-locks at the broker — requires a hedge-enabled broker.",
    category: "strategy-deep-dives",
    minutes: 13,
    free: true,
    section: 6,
    strategy: "2leg_lock",
    intro:
      "2 Leg Lock opens a BUY and a SELL at market as soon as the tab is flat, so it starts locked; there is no entry gap. After Min Time(s), when the Fast Feed leads the broker by your Exec Gap, it closes the wrong side and broker pending orders re-lock the remaining leg. Trailing is only the fallback, if the broker refuses those orders.",
    blocks: [
      {
        type: "setting",
        heading: "Core Parameters",
        body: "Four parameters control the release and the exits:",
        items: [
          "Exec Gap — the release trigger: after Min Time(s), a Fast Feed lead of at least this (Shift and Auto Offset included) closes the wrong side",
          "TrailStart — fallback only: profit from the release fill at which the trailing stop activates, if the broker refused the re-lock orders",
          "TrailDist — fallback only: distance the trailing stop maintains once active",
          "StopLoss — the cage distance: after the release, the broker stop that re-locks the remaining leg rests this far against it. It is not a stop on the combined position; while locked, the lock is the protection",
        ],
      },
      {
        type: "blocked",
        heading: "Broker Requirement",
        body:
          "2 Leg Lock needs a hedge-enabled broker account. It will NOT work on Rithmic or any FIFO-enforced broker.",
      },
    ],
  },
  {
    slug: "trend-impulse",
    title: "Trend Impulse",
    description: "Fast Feed impulse detection for momentum entries.",
    category: "strategy-deep-dives",
    minutes: 10,
    free: true,
    section: 7,
    strategy: "trend_impulse",
    intro: "Trend Impulse watches Fast Feed for sudden directional moves and enters in the direction of the impulse.",
    blocks: [
      {
        type: "info",
        heading: "Fast Feed Impulse Detection",
        body:
          "The strategy watches the fast feed's mid price over a short rolling window. When the price has moved far enough inside that window, it treats the move as an impulse and trades in its direction.",
      },
      {
        type: "setting",
        heading: "Core Parameters",
        body:
          "Two parameters control sensitivity. After a feed pause of more than 2 seconds the window starts again, so a reconnect is not read as an impulse:",
        items: [
          "Impulse Gap — how far, in points, the fast feed's mid price must move inside the window",
          "Time(ms) — the length of that window, in milliseconds",
        ],
      },
    ],
  },
  {
    slug: "obi",
    title: "OBI",
    description: "Trades a one-sided price lead of the fast feed over your broker — needs the Horizon CME feed.",
    category: "strategy-deep-dives",
    minutes: 14,
    free: true,
    section: 8,
    strategy: "obi",
    intro: "OBI trades when one side of the book leads your broker by Imbal Gap while the other side stays within Max Counter. It reads prices, in points, not volume.",
    blocks: [
      {
        type: "info",
        heading: "One-Sided Price Lead",
        body:
          "OBI compares raw Horizon CME prices with your broker's on each side of the book. It buys when the fast bid leads the broker bid by at least Imbal Gap while the broker ask stays less than Max Counter above the fast ask; selling is the mirror. Shift and Auto Offset do not apply, so any futures-vs-CFD basis between the two prices sits inside the gap.",
      },
      {
        type: "setting",
        heading: "Core Parameters",
        body: "Two parameters shape entries:",
        items: [
          "Imbal Gap — how far (points) the fast price must lead the broker on one side of the book to enter",
          "Max Counter — the other side of the book must stay under this (points) for an entry",
        ],
      },
      {
        type: "blocked",
        heading: "Feed Requirement",
        body: "OBI needs the Horizon CME feed — it will not run on a standard broker feed alone.",
      },
    ],
  },
  {
    slug: "grid-arbitrage",
    title: "Grid Arbitrage",
    description: "Fast-feed entries, legs that grow by Lot Mult, and exits for the whole basket.",
    category: "strategy-deep-dives",
    minutes: 16,
    free: true,
    section: 9,
    strategy: "grid",
    intro:
      "Grid Arbitrage opens a first leg when the fast feed leads your broker, adds larger legs as the price moves against the basket, and closes the whole basket together.",
    blocks: [
      {
        type: "info",
        heading: "Entry Logic",
        body:
          "Leg 1 opens when the fast feed leads your broker by at least Trigger Gap points, on the side of the lead. At Trigger Gap 0 the lead test is off: the Trend Filter's EMA sets the side, and a new basket opens when the price crosses to a new side. With the filter off, leg 1 takes the side with the larger lead, and equal leads open nothing. With the Trend Filter on, no leg ever opens on the side it blocks.",
      },
      {
        type: "setting",
        heading: "Progressive Volume",
        body: "Each added leg is larger than the last, and it is added only after a real move against the basket:",
        items: [
          "Lot Mult — each added leg is the previous leg's size times this, rounded up to the next 0.01 lot (0.01, 0.02, 0.04 at 2.0)",
          "Grid Step — how far, in points, the price must move against the last leg before the next leg is added",
          "Leg 2+ Gap — when set, an added leg also needs the fast feed to lead by this many points; at 0 the fast price only has to reach the broker's price",
          "Max Legs — the most legs one basket can hold",
          "Grid Vol. — holds every new leg, leg 1 included, while the fast feed is moving faster than half a Grid Step",
        ],
      },
      {
        type: "setting",
        heading: "Basket Exits & Risk",
        body: "The basket closes as one, and each exit measures something different:",
        items: [
          "Basket TP / Basket SL — points from the FIRST leg's entry price, not from the basket's average or its money result",
          "Trail Start / Trail Dist — once the basket's average profit reaches Trail Start points, profit is locked in Trail Dist steps behind the best level reached",
          "Max DD % — closes the basket when the account's equity falls this far below its balance; it counts the whole account, other tabs and manual trades included",
          "Hard SL — closes any single leg that is this many points against its own entry",
          "Broker safety stop — on MT5 and MT4 every leg also carries a stop at the broker, beyond these levels, that only acts if the terminal cannot",
        ],
      },
    ],
  },
  {
    slug: "risk-and-lot-sizing",
    title: "Risk & Lot Sizing",
    description: "Fixed Lot Size or Risk % sizing, plus the EMA Trend Filter.",
    category: "advanced",
    minutes: 11,
    free: true,
    section: 10,
    intro: "Horizon supports two lot-sizing models, plus a shared trend filter usable across strategies.",
    blocks: [
      {
        type: "setting",
        heading: "Lot Size vs. Risk %",
        body:
          "With Use Risk % off, every entry uses Lot Size. With it on, the terminal sizes each entry so that a loss at Stop Loss costs Risk % of the account balance, using the broker's contract details for the symbol. The size is rounded down to the broker's lot step, never up. Risk % works on MT5 and BloFin; on MT4 and Rithmic the terminal refuses START with Use Risk % ticked. If it cannot size a trade (unknown contract details, a profit currency other than the account's, a size below the broker's minimum or above its maximum), START is refused, or while running the entry is held, and the Trade Log says why; with Stop Loss at 0 it trades the fixed Lot Size and says so.",
      },
      {
        type: "setting",
        heading: "Trend Filter (EMA)",
        body:
          "With Trend Filter ticked, new trades open only on the EMA's side: BUY while your broker's mid price is above it, SELL while below. By default no new trade opens while the price is more than 200 points from the EMA, and exits are never blocked. EMA Period and EMA Source (closed broker candles of Candle (min) minutes, or the last N broker ticks) set how quickly it turns. Ticking 2nd EMA changes the rule: BUY only while the price is above BOTH EMAs, SELL only while below both, nothing in between, with the safe zone measured against the slower EMA. Band adds a dead zone in points around the EMA before a side is taken; Dwell is how many broker ticks the side must hold. The EMA: line under the boxes shows when it is still warming up. 2 Leg Lock does not use it.",
      },
    ],
  },
  {
    slug: "timing-protection",
    title: "Timing/Protection & Stealth",
    description: "Trade pacing, real vs. virtual stops, auto-offset, and the Order Mixer.",
    category: "advanced",
    minutes: 12,
    free: true,
    section: 11,
    publicTitle: "Timing & Protection",
    publicDescription: "Trade pacing, real vs. virtual stops, and auto-offset.",
    publicIntro: "How Horizon times entries and protects open positions.",
    intro:
      "A cluster of protective settings governs how often Horizon trades, how it manages stops, and how it disguises its footprint with brokers.",
    blocks: [
      {
        type: "setting",
        heading: "Timing & Protection",
        body: "These settings pace trading and protect open trades:",
        items: [
          "Trade Pause — seconds to wait after a trade closes, or after your broker rejects an order, before the next entry; 0 still keeps a short built-in pause of a few seconds",
          "Min Time(s) — a stop or target reached before the trade is this old is held, and the trade closes once it reaches this age",
          "Max Time(s) — closes a trade once it is this old; 0 = off",
          "Max Spread — no new entry while your broker's spread is wider than this, in points",
          "RealSL vs. Virtual — whether the stop-loss is sent to the broker or managed internally by the terminal",
          "AutoOffset — automatic adjustment applied to entry/exit levels to account for broker-specific slippage",
        ],
      },
      {
        type: "info",
        heading: "Order Mixer",
        body: "The Order Mixer varies how orders appear to your broker to reduce pattern detection:",
        items: [
          "HideComment — strips or randomizes the order comment field",
          "EA% / Manual% — the mix of orders tagged as automated vs. manual",
        ],
      },
    ],
  },
  {
    slug: "tools-and-troubleshooting",
    title: "Tools & Troubleshooting",
    description: "Tick Recorder, connection errors, order rejections, and performance tips.",
    category: "troubleshooting",
    minutes: 9,
    free: true,
    section: 12,
    intro: "The terminal's built-in diagnostics — plus the fixes for the errors you'll actually run into.",
    blocks: [
      {
        type: "info",
        heading: "Tick Recorder",
        body: "Tick Recorder logs every tick to CSV for later analysis or backtesting, with these columns:",
        items: ["timestamp_ms", "fast_bid", "fast_ask", "slow_bid", "slow_ask"],
      },
      {
        type: "blocked",
        heading: "Connection Errors",
        body: "Four connection error states you may see, and what each means:",
        items: [
          "FastFeed — the Fast Feed data connection is down",
          "Broker — the broker connection is down",
          "Both — both connections are down",
          "Timeout — a connection stopped responding within the expected window",
        ],
      },
      {
        type: "blocked",
        heading: "Order Rejections",
        body: "Common rejection causes reported by brokers:",
        items: [
          "Margin — insufficient margin for the requested size",
          "Symbol — the symbol is unavailable or misconfigured",
          "Lot — lot size outside the broker's allowed range",
          "FillPolicy — the requested fill policy isn't supported for this order",
          "MarketClosed — the market for this symbol is currently closed",
        ],
      },
      {
        type: "setting",
        heading: "Performance Tips",
        body: "A few adjustments that consistently improve live performance:",
        items: [
          "Run on a VPS colocated near your broker or exchange",
          "Enable TrendFilter on Grid Arbitrage to avoid grinding against strong trends",
          "Always validate a new configuration on demo before going live",
          "Set a sensible MinTradeTime to avoid over-trading",
          "Enable HideComment if your broker flags algorithmic order patterns",
        ],
      },
    ],
  },
];

export function getEducationLesson(slug: string): EducationLesson | undefined {
  return EDUCATION_LESSONS.find((lesson) => lesson.slug === slug);
}

/** Old slug -> current slug, for lessons that were renamed. /education/<old> 308s to the current
 * page so bookmarks keep working. No lesson progress is stored anywhere (nothing in the DB is
 * keyed by lesson slug), so a rename only has to carry the URL.
 * - timing-protection-and-stealth: "stealth" is on the do-not-publish list (marcus, m59051). */
const RENAMED_LESSON_SLUGS: ReadonlyMap<string, string> = new Map([
  ["timing-protection-and-stealth", "timing-protection"],
]);

export function renamedLessonSlug(slug: string): string | undefined {
  return RENAMED_LESSON_SLUGS.get(slug);
}

/** A lesson's page. Single spelling of the route so the catalogue's card link and the sign-in
 * return allowlist (post-auth-redirect.ts) cannot point at two different places. */
export function lessonHref(lesson: Pick<EducationLesson, "slug">): string {
  return `/education/${lesson.slug}`;
}
