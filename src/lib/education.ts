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
  /** Single intro paragraph — shown on locked cards and as the opener on full lessons. */
  intro: string;
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
        heading: "20-Character License Key",
        body:
          "Your terminal ships with a 20-character license key tied to your account. Enter it in the activation dialog on first launch to unlock the app.",
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
          "The first run walks you through, in order: license key entry, hardware lock confirmation, and the broker connection wizard. No separate installer step once the key validates.",
      },
    ],
  },
  {
    slug: "interface",
    title: "Interface",
    description: "Tour the tab layout — Strategy controls on the left, Connections on the right.",
    category: "getting-started",
    minutes: 6,
    free: true,
    section: 2,
    intro: "Get oriented with Horizon's dual-pane layout before you touch a single setting.",
    blocks: [
      {
        type: "info",
        heading: "Tab Layout",
        body:
          "The terminal splits into two primary panes: Strategy controls live on the left, Connection status and broker management live on the right.",
      },
      {
        type: "setting",
        heading: "Multi-Tab Workspaces",
        body:
          "Open multiple strategy tabs side by side to run several instruments or configurations at once without losing your place.",
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
    free: false,
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
    free: false,
    section: 5,
    intro: "1 Leg trades the gap between Fast Feed and your broker feed the moment a price discrepancy opens up.",
    blocks: [
      {
        type: "setting",
        heading: "Core Parameters",
        body: "Tune these six parameters to shape entry sensitivity and risk:",
        items: [
          "Gap — minimum Fast Feed/broker price discrepancy required to trigger an entry",
          "Shift — offset applied to the trigger price before comparison",
          "SL — stop loss distance",
          "TP — take profit distance",
          "MaxSpread — maximum broker spread allowed before the strategy stands down",
          "TradePause — cooldown enforced between trades",
        ],
      },
    ],
  },
  {
    slug: "2-leg-lock-hedge-arb",
    title: "2 Leg Lock (Hedge Arb)",
    description: "Hedge-based arbitrage with trailing exits — requires a hedge-enabled broker.",
    category: "strategy-deep-dives",
    minutes: 13,
    free: false,
    section: 6,
    intro:
      "2 Leg Lock opens offsetting positions across two legs and manages them as a hedged pair with a trailing exit.",
    blocks: [
      {
        type: "setting",
        heading: "Core Parameters",
        body: "Four parameters control entry and exit behavior:",
        items: [
          "Gap — minimum price discrepancy required to open the hedge pair",
          "TrailStart — profit level at which the trailing stop activates",
          "TrailDist — distance the trailing stop maintains once active",
          "StopLoss — hard stop applied to the combined position",
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
    free: false,
    section: 7,
    intro: "Trend Impulse watches Fast Feed for sudden directional moves and enters in the direction of the impulse.",
    blocks: [
      {
        type: "info",
        heading: "Fast Feed Impulse Detection",
        body:
          "The strategy monitors Fast Feed for rapid price movement that outpaces the broker feed, treating it as an early signal of directional momentum.",
      },
      {
        type: "setting",
        heading: "Core Parameters",
        body: "Two parameters control sensitivity:",
        items: [
          "TrendGap — minimum Fast Feed movement required to qualify as an impulse",
          "TrendTime — window over which that movement must occur",
        ],
      },
    ],
  },
  {
    slug: "obi",
    title: "OBI",
    description: "Order book imbalance trading on CME L2 depth — needs the Horizon CME feed.",
    category: "strategy-deep-dives",
    minutes: 14,
    free: false,
    section: 8,
    intro: "OBI reads CME Level 2 depth to trade directional order book imbalances.",
    blocks: [
      {
        type: "info",
        heading: "CME L2 Depth",
        body:
          "OBI consumes full CME Level 2 order book depth to gauge buy/sell pressure beyond the top of book.",
      },
      {
        type: "setting",
        heading: "Core Parameters",
        body: "Two parameters shape entries:",
        items: [
          "Imbalance — the buy/sell depth ratio threshold required to trigger an entry",
          "Counter — number of consecutive imbalanced updates required for confirmation",
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
    description: "Candle-momentum entries with progressive grid sizing and basket-level exits.",
    category: "strategy-deep-dives",
    minutes: 16,
    free: false,
    section: 9,
    intro:
      "Grid Arbitrage enters on candle momentum confirmed by a trend filter, then scales a progressive grid as price moves against the basket.",
    blocks: [
      {
        type: "info",
        heading: "Entry Logic",
        body: "Entries trigger on candle momentum, gated by a trend filter to avoid fading a strong move.",
      },
      {
        type: "setting",
        heading: "Progressive Volume",
        body:
          "Each grid step increases position size by roughly 1.4x the prior step, scaling lot size upward as the basket adds legs:",
        items: ["0.05 → 0.07 → 0.10 → 0.14 → 0.20 → 0.28 → 0.39 → 0.55"],
      },
      {
        type: "setting",
        heading: "Basket Exits & Risk",
        body: "The full basket is managed together, not leg by leg:",
        items: [
          "Basket TP / Basket SL — combined take-profit and stop-loss across the whole grid",
          "MaxDD% — maximum drawdown percentage before the basket is force-closed",
          "TrailStart / TrailDist — trailing stop activation level and distance once the basket is in profit",
        ],
      },
    ],
  },
  {
    slug: "risk-and-lot-sizing",
    title: "Risk & Lot Sizing",
    description: "FixedLot vs. Risk%-based auto-lot, plus the EMA trend filter.",
    category: "advanced",
    minutes: 11,
    free: false,
    section: 10,
    intro: "Horizon supports two lot-sizing models, plus a shared trend filter usable across strategies.",
    blocks: [
      {
        type: "setting",
        heading: "FixedLot vs. Risk% (Auto-Lot)",
        body:
          "FixedLot trades a constant lot size on every entry. Risk% instead auto-calculates lot size from your account balance and a target risk percentage per trade — sizing adapts as your account grows or shrinks.",
      },
      {
        type: "setting",
        heading: "TrendFilter (EMA)",
        body:
          "TrendFilter uses an exponential moving average to confirm the prevailing trend before allowing entries, reducing counter-trend trades.",
      },
    ],
  },
  {
    slug: "timing-protection-and-stealth",
    title: "Timing/Protection & Stealth",
    description: "Trade pacing, real vs. virtual stops, auto-offset, and the Order Mixer.",
    category: "advanced",
    minutes: 12,
    free: false,
    section: 11,
    intro:
      "A cluster of protective settings governs how often Horizon trades, how it manages stops, and how it disguises its footprint with brokers.",
    blocks: [
      {
        type: "setting",
        heading: "Timing & Protection",
        body: "These parameters pace trading and protect against bad fills:",
        items: [
          "TradePause — minimum cooldown enforced between trades",
          "MinTradeTime / MaxTradeTime — minimum and maximum time a position may stay open",
          "MaxSpread — spread ceiling above which the strategy will not trade",
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
