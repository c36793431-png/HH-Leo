import type { StrategyKey } from "./setfiles";

export type EducationCategoryKey =
  | "getting-started"
  | "connecting-brokers"
  | "strategy-deep-dives"
  | "troubleshooting"
  | "advanced"
  | "agentic-trading";

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
  // The agentic trading course (coxwell via marcus m67088): members only, never in the public catalogue.
  { key: "agentic-trading", label: "Agentic Trading", subtitle: "A short course on AI agents in trading, and how to use them safely" },
];

export type EducationBlockType = "info" | "setting" | "warning" | "blocked";

/** One step of a block, shown in order after the body: a bold label, a sentence, and/or a command in a monospace box
 * (marcus m66405: the broker-IP tip's Command Prompt line). */
export type EducationPart = {
  label?: string;
  text?: string;
  code?: string;
};

export type EducationBlock = {
  type: EducationBlockType;
  heading: string;
  body: string;
  items?: string[];
  /** Members-only for now: education-signed-out.ts copies block fields by name and does not copy this one. */
  parts?: EducationPart[];
  /** Question and answer pairs, each answer behind a tap (the course's checks and final quiz). Members-only, like parts. */
  qa?: { q: string; a: string }[];
  /** Source or next-step links under the block, opened in a new tab. Members-only, like parts. */
  links?: { label: string; href: string }[];
  /** The label over the block, in place of the type's (course blocks: Check, Takeaways, Step, Quiz). */
  tag?: string;
  /** A figure under the body and items, from a live public post (the OBI guide's images, marcus m73349). The caption is
   * shown; the alt text describes the picture. Click opens the file. Members-only, like parts. */
  image?: { src: string; alt: string; caption: string; width: number; height: number };
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
  /** A course lesson (not a manual section): its place in the course, shown instead of the manual line. Course lessons
   * are members-only: left out of the public catalogue and shown signed out with no blocks. */
  course?: { name: string; lesson: number; of: number; final?: boolean };
  /** A closing line under the blocks (the course's not-financial-advice line). */
  closing?: string;
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
        type: "info",
        heading: "Find your broker's server IP",
        body: "(MT4: replace terminal64 with terminal.)",
        parts: [
          { text: "Newer MT5 builds no longer show the server address in the Journal tab. Windows still shows it." },
          {
            label: "Option 1, Command Prompt (fastest)",
            text: "With MT5 open and logged in, press Windows + R, type cmd, press Enter (Command Prompt, not PowerShell), then paste this as one line:",
          },
          // Typed at the prompt, so a single %a (a .bat file would need %%a).
          { code: "for /f \"tokens=2\" %a in ('tasklist ^| findstr terminal64') do netstat -ano | findstr %a" },
          { text: "The line with ESTABLISHED and :443 is your broker's server. The IP is the part before :443." },
          { text: "MT5 can show several connections (MQL5 community, news, updates). Your broker is the one that stays connected while you're logged in; the others come and go." },
          {
            label: "Option 2, Resource Monitor",
            text: "Press Windows + R, type resmon, press Enter. Open Network, then TCP Connections, tick terminal64.exe. The Remote Address on port 443 is the broker's server IP; Latency (ms) shows your ping.",
          },
          { text: "MT5 can show several connections (MQL5 community, news, updates). Your broker is the one that stays connected while you're logged in; the others come and go." },
        ],
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
        type: "warning",
        heading: "Stopping safely",
        body:
          "When you want to stop and close, press STOP first and then Close Trade, in that order. If you press Close Trade first, wait until the log shows \"Pause complete\" before pressing STOP. Afterwards, check your open positions to confirm everything is flat.",
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
    // Blocks GENERATED by gen_portal_obi.py from the live www OBI guide (obi-explained.ts md5 9683f235) + the 2.1 notes
    // (release-21.ts md5 f2f80a28), the same cut as www /education/obi (marcus m72890 part D, m73349). Regenerate, don't edit.
    blocks: [
      {
        type: "info",
        heading: "How OBI works",
        body: "OBI (Order Book Imbalance) is one of the five Horizon strategies, next to 1 Leg, 2 Leg Lock, Trend Impulse and Grid. It looks for moments when the fast CME market has clearly moved on one side of the book while your broker has not caught up yet, and trades that lead. This guide explains how it decides and how to start safely.",
        image: {
          src: "/education/obi/obi-how-it-works.webp",
          alt: "How OBI works, in one picture. 1, after START: Auto Offset removes the basis between futures and CFD, then wait for \"Auto-Offset locked\". From 2.1 entries wait for this automatically; until then you wait for the log line. 2, every tick: compare the fast CME prices with your broker's, each side separately. BUY when the fast bid is ahead of the broker bid by at least Imbal Gap and the ask has not moved the other way by Max Counter or more; SELL is the mirror. Filters: Max Spread, Trade Pause, and an optional Trend Filter for gold. Then enter, one trade at a time. 3, exits: TP and SL in points from the entry, Hard SL checked by Horizon every tick, Trailing when Trail Start and Trail Dist are above 0, Min Time holds TP and SL for a set time, and Max Time still applies during Min Time. An illustration, no real prices.",
          caption: "How OBI works: Auto Offset first, then a price-gap check on every tick, filters, one trade at a time, and the exits. An illustration, no real prices.",
          width: 1600,
          height: 1160
        }
      },
      {
        type: "blocked",
        heading: "What you need",
        body: "",
        items: [
          "Horizon 2.1 or newer. 2.1 waits until Auto Offset has locked before the first entry; 2.0.9 brought the Auto Offset correction itself. Please update before you run it.",
          "The Horizon CME Fast Feed. OBI only starts on the \"Horizon CME\" feed. On any other feed, START refuses it.",
          "A broker instrument that follows the CME contract, for example gold (GC → XAUUSD) or US indices (ES → US500, NQ → NAS100)."
        ]
      },
      {
        type: "info",
        heading: "How OBI decides to enter",
        body: "On every tick, OBI compares the fast CME prices with your broker's prices, on each side of the book separately:",
        items: [
          "BUY when the fast bid is ahead of your broker's bid by at least Imbal Gap, and the ask side has not moved the opposite way by Max Counter or more.",
          "SELL is the mirror: the fast ask has dropped below the broker's ask by at least Imbal Gap, and the bid side has not moved the opposite way by Max Counter or more."
        ],
        image: {
          src: "/education/obi/obi-entry-diagram.svg",
          alt: "How OBI enters a BUY: the fast bid is ahead of your broker's bid by at least Imbal Gap, while the ask side is not pulling the other way by Max Counter or more. An illustration, no real prices.",
          caption: "How OBI enters a BUY: the fast bid is ahead of your broker's bid by at least Imbal Gap, while the ask side is not pulling the other way by Max Counter or more. An illustration, no real prices.",
          width: 1200,
          height: 630
        },
        parts: [
          {
            text: "In plain words: one side of the market has clearly moved, and the other side hasn't moved against it. If both sides lead in the same direction, that also counts. Both settings are in points, using the tab's Point value (0.01 by default)."
          }
        ]
      },
      {
        type: "setting",
        heading: "Filters",
        body: "OBI holds one trade at a time. Two filters stop it entering in bad conditions:",
        items: [
          "Max Spread: no entry while your broker's spread is wider than this.",
          "Trade Pause: how long OBI waits after a trade closes before it may enter again (0 = no pause; default 2 seconds)."
        ],
        image: {
          src: "/education/obi/obi-settings.png",
          alt: "The OBI settings in Horizon: position sizing, exits, Max Spread, Trade Pause, Imbal Gap and Max Counter.",
          caption: "The OBI settings in Horizon: position sizing, exits, Max Spread, Trade Pause, Imbal Gap and Max Counter.",
          width: 264,
          height: 690
        },
        parts: [
          {
            text: "If you tick Trend Filter, OBI also only trades in the direction of the trend. The Trend Filter is meant for gold (XAUUSD)."
          }
        ]
      },
      {
        type: "warning",
        heading: "Note on the name",
        body: "OBI works on prices, not traded volume. The Horizon CME feed does not carry order-book depth, so OBI always runs on the price gap and Max Counter. Horizon writes a note in the log at START, and another line once it has seen 30 seconds of quotes without depth."
      },
      {
        type: "setting",
        heading: "How OBI exits",
        body: "",
        items: [
          "Take Profit / Stop Loss: in points from the entry.",
          "Hard SL: a backstop in points from the entry price (0 = off). It is checked by Horizon on every tick, not placed at your broker, so Horizon must be running. We recommend keeping it on.",
          "Trailing: only active when both Trail Start and Trail Dist are above 0.",
          "Min Time(s): holds Take Profit and Stop Loss for this many seconds. Hard SL and Max Time still apply during that time."
        ]
      },
      {
        type: "warning",
        heading: "A safe way to start",
        body: "",
        items: [
          "Start on a demo account. Run at least one full session before going live.",
          "Keep Auto Offset on and wait for the log line \"Auto-Offset locked\". After that the chart settles at a steady level, roughly half the difference between your broker's spread and the CME spread. Set Imbal Gap well above that level.",
          "Check Shift is 0. The Shift box is hidden on an OBI tab, but a value typed while this same tab was set to 1 Leg carries over unseen. Switch the tab to 1 Leg, check Shift is 0, then switch back to OBI.",
          "Begin with the smallest lot. Use Risk % only once you trust the behaviour.",
          "Keep Hard SL on and set Max Spread to your broker's normal spread plus a margin.",
          "One OBI tab per instrument, with its own Magic number, so trades never mix with your other tabs.",
          "Trade liquid hours. OBI needs a live CME market. Around the daily CME break and at the weekly open, quotes are thin and gaps are unreliable.",
          "Review your first trades. If OBI signals constantly, Imbal Gap is too close to the settled level. Stop and check before you continue."
        ]
      },
      {
        type: "info",
        heading: "What's new in 2.1",
        body: "Auto Offset now holds new entries until it has learned the offset. 1 Leg, Order Book Imbalance and Grid Arbitrage (its first level) open nothing new, and 2 Leg Lock opens no new pair, until the Auto Offset has its 50 samples. This happens after every START, after STOP and START, and after a feed reset while the tab is flat. The log shows \"Auto-Offset warming up: ... entries held until the offset locks\" when the hold starts, and \"Auto-Offset locked, entries enabled\" when trading can begin. Open trades keep every exit while entries are held. Before 2.1 these strategies could enter on the very first price after START, before the offset was known. On a pair whose two prices differ by more than your Gap (for example a futures fast feed against a CFD broker), that first entry used the unadjusted difference.",
        links: [
          {
            label: "OBI explained (full guide)",
            href: "https://www.horizonhft.com/blog/obi-explained"
          },
          {
            label: "Horizon v2.1 release notes",
            href: "https://www.horizonhft.com/blog/horizon-v2-1-release-notes"
          }
        ]
      }
    ],
    closing: "Trading involves risk, including the loss of your capital. Results depend on your broker, account type, latency and market conditions. Past performance does not guarantee future results. Test on a demo account first.",
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
  // ---- Agentic trading course (coxwell 10-13 ~13:05Z via marcus m67088; outline v2, Fable PASS m67084). Every
  // sentence is cut from the checked blog /blog/what-is-agentic-trading (or live /horizon-ai for lesson 7); the few
  // that are not were listed for Fable. Sections 101-108 sit outside the manual's 1-12: course lessons show
  // 'Lesson N of 7' instead, and never reach the public catalogue (www has no pages for them).
  {
    slug: "agentic-trading-what-it-is",
    title: "What agentic trading is",
    description: "An assistant explains things. An agent acts.",
    category: "agentic-trading",
    minutes: 4,
    free: true,
    section: 101,
    course: { name: "Agentic trading course", lesson: 1, of: 7 },
    intro: "To understand agentic trading, we first need to look at the difference between an AI assistant and an AI agent.",
    blocks: [
      {
        type: "info",
        tag: "Info",
        heading: "An assistant explains",
        body: "An assistant explains things. If you ask a standard AI assistant to analyze a gold chart, it will read the historical data and give you a summary of support and resistance levels. It stops there. You have to open your trading platform, find the right chart, set the alerts, and place the trades yourself. The assistant is entirely passive.",
      },
      {
        type: "info",
        tag: "Info",
        heading: "An agent acts",
        body: "An agent acts. Agentic trading means giving an AI system controlled access to your trading platform or brokerage account so it can carry out specific steps on its own, within the strict limits you set. Instead of just telling you that gold has hit a key level, an agentic system can be authorized to automatically draw the Fibonacci levels on your chart, set up the price alerts, or even prepare an order ticket for your final approval.",
      },
      {
        type: "info",
        tag: "Info",
        heading: "Is agentic trading the same as algorithmic trading?",
        body: "No. Algorithmic trading relies on strict, pre-programmed mathematical rules (like an Expert Advisor) that execute automatically. Agentic trading involves an AI that understands natural language and can perform a variety of dynamic platform tasks based on your conversational instructions.",
      },
      {
        type: "info",
        tag: "Info",
        heading: "Do I need to know how to code to use AI agents?",
        body: "No. The primary appeal of agentic trading tools and MCP connectors is that they allow you to interact with your trading platform using plain English.",
      },
      {
        type: "info",
        tag: "Check",
        heading: "Check yourself",
        body: "",
        qa: [
          { q: "What does an AI assistant do when you ask it to analyze a gold chart?", a: "It will read the historical data and give you a summary of support and resistance levels. It stops there." },
          { q: "What does agentic trading give an AI system?", a: "Controlled access to your trading platform or brokerage account so it can carry out specific steps on its own, within the strict limits you set." },
          { q: "Is agentic trading the same as algorithmic trading?", a: "No. Algorithmic trading relies on strict, pre-programmed mathematical rules (like an Expert Advisor) that execute automatically." },
        ],
      },
      {
        type: "setting",
        tag: "Takeaways",
        heading: "Key takeaways",
        body: "",
        items: [
          "An assistant explains things.",
          "An agent acts.",
          "In short, agentic trading bridges the gap between analysis and platform execution.",
        ],
      },
    ],
    closing: "This article is for information only and is not financial advice. Trading involves risk, and you can lose money.",
  },
  {
    slug: "agentic-trading-where-it-is-today",
    title: "Where it is today",
    description: "These official updates mean agentic trading is no longer a future concept.",
    category: "agentic-trading",
    minutes: 5,
    free: true,
    section: 102,
    course: { name: "Agentic trading course", lesson: 2, of: 7 },
    intro: "Agentic trading is dominating the news because the biggest platforms in the industry have officially opened their doors to it in 2026.",
    blocks: [
      {
        type: "info",
        tag: "Info",
        heading: "As of October 2026",
        body: "They are doing this primarily through a new technology standard called the Model Context Protocol (MCP), which acts like a universal plug letting AI assistants connect to trading software.",
      },
      {
        type: "info",
        tag: "Info",
        heading: "What is the Model Context Protocol (MCP)?",
        body: "MCP is an open standard that lets AI assistants connect to outside tools, such as a trading platform, and use only the actions that tool allows. What an AI can do through MCP depends on the permissions the platform and you give it.",
      },
      {
        type: "info",
        tag: "Info",
        heading: "MetaTrader 5",
        body: "MetaQuotes, the company behind the industry-standard MetaTrader platforms, introduced native support for MCP and agentic AI in MetaTrader 5 Build 6060 in July 2026. Later builds through Build 6230 (24 September 2026) widened what the built-in AI can do on its own: read an EA's inputs and prepare a Strategy Tester run, launch or remove EAs, scripts and indicators on charts, and read the built-in Economic Calendar.",
      },
      {
        type: "info",
        tag: "Info",
        heading: "TradingView",
        body: "In September 2026, they launched the TradingView MCP Server in public beta for paid plans. This allows traders to connect AI platforms directly to their TradingView accounts to pull quotes, run the Screener, analyze fundamentals, and manage watchlists and alerts from a single conversation. The beta has limits worth knowing: it cannot place orders, the market data it serves is delayed, the tool list is limited and daily requests are capped.",
      },
      {
        type: "info",
        tag: "Info",
        heading: "Brokerages",
        body: "Dukascopy Bank introduced an MCP server for its JForex platform in June 2026. It is available on demo accounts, where the AI can place market and pending orders, and the bank said support for live accounts was planned to follow. Match-Trade Technologies followed in October 2026 with two MCP servers: a read-only one that lets brokers and prop firms query their Match-Trader data, and one for traders that can open, modify and close positions, with the trader confirming each action.",
      },
      {
        type: "warning",
        tag: "Warning",
        heading: "The line that matters",
        body: "Note what these connectors share: on MetaTrader 5, on JForex demo and on Match-Trader, the AI can send orders to your account once you allow it. That is the line that matters for the rest of this guide.",
      },
      {
        type: "info",
        tag: "Info",
        heading: "Sources",
        body: "",
        links: [
          { label: "Model Context Protocol, official site (what MCP is)", href: "https://modelcontextprotocol.io/" },
          { label: "MetaTrader 5 Build 6060: AI integration and MCP (MetaQuotes)", href: "https://www.metaquotes.net/en/metatrader5/news/5538" },
          { label: "MetaTrader 5 Build 6230: expanded AI capabilities (MetaQuotes)", href: "https://www.metaquotes.net/en/metatrader5/news/5561" },
          { label: "All MetaTrader 5 release notes (MetaQuotes)", href: "https://www.metaquotes.net/en/metatrader5/news" },
          { label: "TradingView adds MCP (Finance Magnates)", href: "https://www.financemagnates.com/forex/tradingview-adds-mcp-as-retail-brokers-adopt-ai-trading-tools/" },
          { label: "Dukascopy launches AI trading via MCP (Dukascopy)", href: "https://www.dukascopy.com/swiss/english/full-news/dukascopy-becomes-the-first-swiss-bank-to-launch-ai-powered-trading-via-mcp/" },
          { label: "Match-Trader management MCP for brokers and prop firms (Finance Magnates)", href: "https://www.financemagnates.com/forex/brokers-and-prop-firms-get-management-mcp-from-match-trader/" },
        ],
      },
      {
        type: "info",
        tag: "Check",
        heading: "Check yourself",
        body: "",
        qa: [
          { q: "What is MCP, in plain words?", a: "A universal plug letting AI assistants connect to trading software." },
          { q: "Can the TradingView MCP Server place orders?", a: "No. The beta has limits worth knowing: it cannot place orders, the market data it serves is delayed, the tool list is limited and daily requests are capped." },
          { q: "What is the line that matters?", a: "On MetaTrader 5, on JForex demo and on Match-Trader, the AI can send orders to your account once you allow it." },
        ],
      },
      {
        type: "setting",
        tag: "Takeaways",
        heading: "Key takeaways",
        body: "",
        items: [
          "What an AI can do through MCP depends on the permissions the platform and you give it.",
          "On MetaTrader 5, on JForex demo and on Match-Trader, the AI can send orders to your account once you allow it.",
          "These official updates mean agentic trading is no longer a future concept; it is actively built into the tools you already use.",
        ],
      },
    ],
    closing: "This article is for information only and is not financial advice. Trading involves risk, and you can lose money.",
  },
  {
    slug: "agentic-trading-what-can-go-wrong",
    title: "What can go wrong",
    description: "No AI can predict the markets.",
    category: "agentic-trading",
    minutes: 4,
    free: true,
    section: 103,
    course: { name: "Agentic trading course", lesson: 3, of: 7 },
    intro: "With all this new technology entering the retail trading space, it is crucial to separate reality from science fiction.",
    blocks: [
      {
        type: "warning",
        tag: "Warning",
        heading: "No AI can predict the markets",
        body: "Agentic trading tools do not possess a crystal ball. They process data, follow instructions, and execute platform commands at high speed, but they cannot foresee sudden geopolitical events, unexpected central bank rate hikes, or random market volatility. They are tools for workflow efficiency, not guaranteed success.",
      },
      {
        type: "warning",
        tag: "Warning",
        heading: "Permissions that are too broad",
        body: "There are also real, tangible risks involved when letting software act on your account. When you connect an AI agent to your platform, you are granting it permissions to interact with your workspace. If those permissions are too broad, a misunderstood prompt could lead to unintended actions, such as removing the wrong EA from a chart, launching a script you did not mean to run, or modifying an alert incorrectly. Mistakes in automated environments can quickly lead to real costs if they impact your active positions or cause you to miss a critical market move.",
      },
      {
        type: "warning",
        tag: "Warning",
        heading: "Two tuning traps",
        body: "Watch for the two classic tuning traps: fitting the settings to the last few weeks of data, and switching settings every time the market mood changes.",
      },
      {
        type: "warning",
        tag: "Warning",
        heading: "Prompt injection",
        body: "Broker messages, news, logs and emails can contain text written to trick an AI into doing something you did not ask for. This is called prompt injection. Limit the agent to sources you trust, and rely on the hard limits in lesson 4, so that even a fooled agent cannot do much harm.",
        links: [
          { label: "OWASP Top 10 for LLM Applications, LLM01:2025 Prompt Injection", href: "https://genai.owasp.org/llmrisk/llm01-prompt-injection/" },
        ],
      },
      {
        type: "info",
        tag: "Check",
        heading: "Check yourself",
        body: "",
        qa: [
          { q: "Can an AI agent guarantee profits?", a: "Absolutely not. AI agents are workflow and efficiency tools. They do not predict market direction, and they carry the same trading risks as any manual or algorithmic approach." },
          { q: "What are the two classic tuning traps?", a: "Fitting the settings to the last few weeks of data, and switching settings every time the market mood changes." },
          { q: "What is prompt injection?", a: "Broker messages, news, logs and emails can contain text written to trick an AI into doing something you did not ask for. This is called prompt injection." },
        ],
      },
      {
        type: "setting",
        tag: "Takeaways",
        heading: "Key takeaways",
        body: "",
        items: [
          "No AI can predict the markets.",
          "They are tools for workflow efficiency, not guaranteed success.",
          "Treat everything the agent reads as data, not instructions.",
        ],
      },
    ],
    closing: "This article is for information only and is not financial advice. Trading involves risk, and you can lose money.",
  },
  {
    slug: "agentic-trading-safe-structure",
    title: "A safe structure, step by step",
    description: "The structure around it matters more than the AI itself.",
    category: "agentic-trading",
    minutes: 6,
    free: true,
    section: 104,
    course: { name: "Agentic trading course", lesson: 4, of: 7 },
    intro: "If you decide to let an AI agent work on your trading setup, the structure around it matters more than the AI itself. Here is a layout that holds up in practice, and that you can use to judge any product, including one you build yourself.",
    blocks: [
      {
        type: "setting",
        tag: "Step",
        heading: "Keep the AI out of the fast path",
        body: "Your strategy or EA should keep trading on its own, at full speed, exactly as it does today. The agent sits in a separate, slower layer: it watches results, reads your settings and suggests changes. If the agent crashes, freezes or gets something wrong, your trading carries on unchanged. Engineers call this splitting the control plane from the data plane, and it is the single most useful safeguard.",
      },
      {
        type: "setting",
        tag: "Step",
        heading: "Choose how much the agent may do, one step at a time",
        body: "There are four levels, and each one carries more risk than the last:",
        items: [
          "Warnings only: the agent watches and tells you when something looks wrong.",
          "Proposals you confirm: the agent suggests a specific settings change, and nothing happens until you press Confirm.",
          "Automatic changes inside your limits: the agent changes settings on its own, but only within limits you set in advance.",
          "Opening and closing trades: the agent acts on your positions directly. This is the level with the most risk. If a strategy already decides your trades, keep the agent on the settings the strategy trades from and leave the trades to the strategy.",
        ],
      },
      {
        type: "warning",
        tag: "Warning",
        heading: "Start at the first level",
        body: "Start at the first level, and only move up once the level below has proved itself on your own account. Most traders never need the fourth.",
      },
      {
        type: "setting",
        tag: "Step",
        heading: "Put hard limits in code, not in the AI's judgement",
        body: "Limits should be enforced by a small, fixed program the agent cannot talk its way around. Good limits include:",
        items: [
          "a maximum lot size and risk per trade that no change can exceed;",
          "a change budget (for example, a few changes per day);",
          "a cool-down period between changes;",
          "an expiry on every change, so it rolls back automatically unless it is confirmed again;",
          "a saved baseline of your known-good settings you can return to with one click;",
          "an off switch for the agent that puts your saved baseline back at once, and leaves your strategy running.",
        ],
      },
      {
        type: "setting",
        tag: "Step",
        heading: "Keep a log of everything",
        body: "Every warning, proposal, change and decision should be written down with the time and the reason. When something goes wrong, the log is how you find out why.",
      },
      {
        type: "info",
        tag: "Check",
        heading: "Check yourself",
        body: "",
        qa: [
          { q: "What happens to your trading if the agent crashes?", a: "If the agent crashes, freezes or gets something wrong, your trading carries on unchanged." },
          { q: "Which level carries the most risk?", a: "Opening and closing trades: the agent acts on your positions directly. This is the level with the most risk." },
          { q: "Who should enforce the limits?", a: "A small, fixed program the agent cannot talk its way around." },
        ],
      },
      {
        type: "setting",
        tag: "Takeaways",
        heading: "Key takeaways",
        body: "",
        items: [
          "Keep the AI out of the fast path.",
          "Start at the first level, and only move up once the level below has proved itself on your own account.",
          "Put hard limits in code, not in the AI's judgement.",
          "Keep a log of everything.",
        ],
      },
    ],
    closing: "This article is for information only and is not financial advice. Trading involves risk, and you can lose money.",
  },
  {
    slug: "agentic-trading-testing",
    title: "Testing before real money",
    description: "Test before it touches real money.",
    category: "agentic-trading",
    minutes: 3,
    free: true,
    section: 105,
    course: { name: "Agentic trading course", lesson: 5, of: 7 },
    intro: "Test before it touches real money.",
    blocks: [
      {
        type: "setting",
        tag: "Step",
        heading: "Replay recent market data first",
        body: "Replay recent market data first, but remember that a backtest on the same data you tuned on proves very little.",
      },
      {
        type: "setting",
        tag: "Step",
        heading: "Run it next to an identical demo account",
        body: "Then run the agent on a demo account next to an identical demo account it does not touch, for several weeks, and compare the two.",
      },
      {
        type: "setting",
        tag: "Step",
        heading: "Then a small live pilot",
        body: "Only then try a small live pilot.",
      },
      {
        type: "info",
        tag: "Info",
        heading: "Moving up a level",
        body: "Start at the first level, and only move up once the level below has proved itself on your own account.",
      },
      {
        type: "info",
        tag: "Check",
        heading: "Check yourself",
        body: "",
        qa: [
          { q: "What does a backtest on the same data you tuned on prove?", a: "Very little." },
          { q: "What should the agent run next to?", a: "An identical demo account it does not touch, for several weeks." },
          { q: "When do you move up a level?", a: "Once the level below has proved itself on your own account." },
        ],
      },
      {
        type: "setting",
        tag: "Takeaways",
        heading: "Key takeaways",
        body: "",
        items: [
          "Remember that a backtest on the same data you tuned on proves very little.",
          "Run the agent on a demo account next to an identical demo account it does not touch, for several weeks, and compare the two.",
          "Only then try a small live pilot.",
        ],
      },
    ],
    closing: "This article is for information only and is not financial advice. Trading involves risk, and you can lose money.",
  },
  {
    slug: "agentic-trading-rules",
    title: "Rules and responsibility",
    description: "The further up the levels you go, the more likely it is that rules written for advisers or algorithmic trading apply to it.",
    category: "agentic-trading",
    minutes: 5,
    free: true,
    section: 106,
    course: { name: "Agentic trading course", lesson: 6, of: 7 },
    intro: "This is not legal advice, but be aware that the further up the levels you go, the more likely it is that rules written for advisers or algorithmic trading apply to it.",
    blocks: [
      {
        type: "info",
        tag: "Info",
        heading: "In the EU",
        body: "In the EU, the definition of algorithmic trading covers computers that decide order details with little or no human input.",
        links: [
          { label: "MiFID II, Directive 2014/65/EU, Article 4(1)(39), definition of algorithmic trading", href: "https://eur-lex.europa.eu/eli/dir/2014/65/oj/eng" },
        ],
      },
      {
        type: "info",
        tag: "Info",
        heading: "In the UK",
        body: "In the UK, the regulator's guidance says software that generates buy or sell signals can amount to advice on investments, unless the user controls the inputs and settings enough for the signals to count as their own.",
        links: [
          { label: "FCA Handbook, PERG 8.30.3, software that generates buy, sell or hold signals", href: "https://www.handbook.fca.org.uk/handbook/PERG/8/30.html" },
        ],
      },
      {
        type: "info",
        tag: "Info",
        heading: "In the US",
        body: "In the US, the CFTC found in 2019 that two firms selling a forex \"autotrader\", which entered and exited trades without the customer's involvement, were exercising discretionary trading authority over customers' accounts and had to be registered, even though customers installed the software and loaded its updates themselves. The US securities regulator has also fined two investment advisers for overstating what their AI does. The SEC chair said at the time: \"Such AI washing hurts investors.\"",
        links: [
          { label: "CFTC, Silver Star FX / Silver Star Live Software, press release 8071-19 (4 Nov 2019)", href: "https://www.cftc.gov/PressRoom/PressReleases/8071-19" },
          { label: "CFTC order, Silver Star FX (4 Nov 2019)", href: "https://www.cftc.gov/media/2946/enfsilverstarfxorder110419/download" },
          { label: "SEC press release 2024-36, Delphia (USA) Inc. and Global Predictions Inc., 18 Mar 2024", href: "https://www.sec.gov/newsroom/press-releases/2024-36" },
        ],
      },
      {
        type: "warning",
        tag: "Warning",
        heading: "A practical checklist",
        body: "",
        items: [
          "Always restrict permissions, require manual confirmation for trades, and never grant withdrawal access.",
          "Be wary of any product that promises AI profits.",
          "Ask who decides each change.",
          "If you are offering an agent to other people, speak to a lawyer first.",
        ],
      },
      {
        type: "info",
        tag: "Check",
        heading: "Check yourself",
        body: "",
        qa: [
          { q: "In the EU, what does the definition of algorithmic trading cover?", a: "Computers that decide order details with little or no human input." },
          { q: "What did the CFTC find in 2019?", a: "That two firms selling a forex \"autotrader\" were exercising discretionary trading authority over customers' accounts and had to be registered, even though customers installed the software and loaded its updates themselves." },
          { q: "Should you ever grant withdrawal access?", a: "No. Always restrict permissions, require manual confirmation for trades, and never grant withdrawal access." },
        ],
      },
      {
        type: "setting",
        tag: "Takeaways",
        heading: "Key takeaways",
        body: "",
        items: [
          "The further up the levels you go, the more likely it is that rules written for advisers or algorithmic trading apply to it.",
          "Be wary of any product that promises AI profits.",
          "If you are offering an agent to other people, speak to a lawyer first.",
        ],
      },
    ],
    closing: "This is not legal advice. This article is for information only and is not financial advice. Trading involves risk, and you can lose money.",
  },
  {
    slug: "agentic-trading-horizon-ai",
    title: "How Horizon AI fits",
    description: "An assistant that knows your setup but never touches your account.",
    category: "agentic-trading",
    minutes: 3,
    free: true,
    section: 107,
    course: { name: "Agentic trading course", lesson: 7, of: 7 },
    intro: "The simplest way to keep the risk down is the first level in lesson 4: an assistant that knows your setup but never touches your account. That is how we built Nova, the assistant inside Horizon AI.",
    blocks: [
      {
        type: "info",
        tag: "Info",
        heading: "Nova today",
        body: "A private AI assistant on Telegram for Horizon HFT clients. One Nova per client.",
        items: [
          "Horizon setup, licence, brokers and Fast Feed",
          "What each strategy setting does and why",
          "Reading screenshots and logs you send",
          "Your other platforms, VPS and broker setup too",
        ],
      },
      {
        type: "warning",
        tag: "Warning",
        heading: "What Nova never does",
        body: "It explains and guides; you make every change. Nova is an AI assistant: it can make mistakes, and trading decisions stay yours.",
        items: [
          "Place, close or change trades",
          "Change your settings for you",
          "Give financial advice or signals",
          "Ask for or repeat passwords",
        ],
      },
      {
        type: "info",
        tag: "Info",
        heading: "Agent plans: coming soon",
        body: "Pricing on request. They are being built on the structure in lesson 4. We will publish exactly what each tier can and cannot touch before it goes live.",
        items: [
          "Guided: your own agent, on your own VPS, standard monthly usage",
          "Guided Plus: same as Guided, ~4x the monthly usage",
          "Always-on: monitoring and alerts for your VPS, feed and Horizon, ~10x the monthly usage",
        ],
        links: [
          { label: "Request your 1-week free trial", href: "https://www.horizonhft.com/horizon-ai#nova" },
          { label: "Register interest", href: "https://www.horizonhft.com/horizon-ai#agents" },
        ],
      },
      {
        type: "info",
        tag: "Check",
        heading: "Check yourself",
        body: "",
        qa: [
          { q: "Does Nova have access to your trading account?", a: "No. Nova is a setup and support assistant for your Horizon HFT software and settings. It has no access to your trading account, cannot place or manage trades, and gives no trading advice or signals." },
          { q: "Who makes each change?", a: "You do. It explains and guides; you make every change." },
          { q: "Are the agent plans available today?", a: "Not yet. Guided, Guided Plus and Always-on are coming soon." },
        ],
      },
      {
        type: "setting",
        tag: "Takeaways",
        heading: "Key takeaways",
        body: "",
        items: [
          "It explains and guides; you make every change.",
          "Nova is an AI assistant: it can make mistakes, and trading decisions stay yours.",
          "We will publish exactly what each tier can and cannot touch before it goes live.",
        ],
      },
    ],
    closing: "This article is for information only and is not financial advice. Trading involves risk, and you can lose money.",
  },
  {
    slug: "agentic-trading-final-check",
    title: "Final check",
    description: "Ten questions across lessons 1 to 6.",
    category: "agentic-trading",
    minutes: 5,
    free: true,
    section: 108,
    course: { name: "Agentic trading course", lesson: 8, of: 7, final: true },
    intro: "Ten questions across lessons 1 to 6. Answer each one, then open it to check.",
    blocks: [
      {
        type: "info",
        tag: "Quiz",
        heading: "Final check",
        body: "",
        qa: [
          { q: "1. What is the difference between an AI assistant and an AI agent?", a: "An assistant explains things. An agent acts." },
          { q: "2. Do you need to know how to code to use AI agents?", a: "No. The primary appeal of agentic trading tools and MCP connectors is that they allow you to interact with your trading platform using plain English." },
          { q: "3. What is MCP?", a: "MCP is an open standard that lets AI assistants connect to outside tools, such as a trading platform, and use only the actions that tool allows. What an AI can do through MCP depends on the permissions the platform and you give it." },
          { q: "4. On which connectors can the AI send orders to your account once you allow it?", a: "On MetaTrader 5, on JForex demo and on Match-Trader." },
          { q: "5. Can an AI agent guarantee profits?", a: "Absolutely not. AI agents are workflow and efficiency tools. They do not predict market direction, and they carry the same trading risks as any manual or algorithmic approach." },
          { q: "6. What is prompt injection?", a: "Broker messages, news, logs and emails can contain text written to trick an AI into doing something you did not ask for. This is called prompt injection." },
          { q: "7. What happens to your trading if the agent crashes?", a: "If the agent crashes, freezes or gets something wrong, your trading carries on unchanged." },
          { q: "8. Which of the four levels carries the most risk?", a: "Opening and closing trades: the agent acts on your positions directly. This is the level with the most risk." },
          { q: "9. What comes before a small live pilot?", a: "Replay recent market data first, but remember that a backtest on the same data you tuned on proves very little. Then run the agent on a demo account next to an identical demo account it does not touch, for several weeks, and compare the two." },
          { q: "10. Should an AI connection ever have withdrawal access?", a: "No. Always restrict permissions, require manual confirmation for trades, and never grant withdrawal access." },
        ],
      },
    ],
    closing: "This article is for information only and is not financial advice. Trading involves risk, and you can lose money.",
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

/** The course lesson after this one (lesson 7 -> the final check), for the 'Next lesson' link (marcus m67166).
 * None for the final check and for any lesson that is not in a course. */
export function nextCourseLesson(lesson: Pick<EducationLesson, "course">): EducationLesson | undefined {
  const at = lesson.course;
  if (!at || at.final) return undefined;
  return EDUCATION_LESSONS.find((l) => l.course?.name === at.name && l.course.lesson === at.lesson + 1);
}
