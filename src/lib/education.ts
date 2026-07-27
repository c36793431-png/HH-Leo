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

export type EducationLesson = {
  slug: string;
  title: string;
  description: string;
  category: EducationCategoryKey;
  minutes: number;
  free: boolean;
};

export const EDUCATION_LESSONS: EducationLesson[] = [
  {
    slug: "welcome-to-horizon-terminal",
    title: "Welcome to Horizon Terminal",
    description: "A quick orientation to the terminal and what you can do with it.",
    category: "getting-started",
    minutes: 6,
    free: true,
  },
  {
    slug: "installing-and-licensing",
    title: "Installing & Licensing Your Terminal",
    description: "Download, install, and activate your license key.",
    category: "getting-started",
    minutes: 5,
    free: true,
  },
  {
    slug: "terminal-layout-tour",
    title: "Terminal Layout Tour",
    description: "A guided walkthrough of panels, workspaces, and shortcuts.",
    category: "getting-started",
    minutes: 8,
    free: true,
  },
  {
    slug: "placing-your-first-order",
    title: "Placing Your First Order",
    description: "Submit, modify, and cancel orders from the terminal.",
    category: "getting-started",
    minutes: 7,
    free: true,
  },
  {
    slug: "supported-broker-overview",
    title: "Supported Broker Overview",
    description: "Which brokers and venues Horizon connects to today.",
    category: "connecting-brokers",
    minutes: 5,
    free: true,
  },
  {
    slug: "connecting-via-fix-quick-start",
    title: "Connecting via FIX — Quick Start",
    description: "Get a FIX session up and running in minutes.",
    category: "connecting-brokers",
    minutes: 9,
    free: true,
  },
  {
    slug: "ibkr-gateway-setup",
    title: "IBKR Gateway Setup",
    description: "Configure Interactive Brokers Gateway for live trading.",
    category: "connecting-brokers",
    minutes: 11,
    free: false,
  },
  {
    slug: "advanced-fix-session-tuning",
    title: "Advanced FIX Session Tuning",
    description: "Heartbeats, sequence resets, and session resilience.",
    category: "connecting-brokers",
    minutes: 13,
    free: false,
  },
  {
    slug: "multi-account-broker-routing",
    title: "Multi-Account Broker Routing",
    description: "Route orders across multiple broker accounts.",
    category: "connecting-brokers",
    minutes: 10,
    free: false,
  },
  {
    slug: "market-making-fundamentals",
    title: "Market-Making Fundamentals",
    description: "Core concepts behind quoting both sides of the book.",
    category: "strategy-deep-dives",
    minutes: 15,
    free: false,
  },
  {
    slug: "latency-arbitrage-primer",
    title: "Latency Arbitrage Primer",
    description: "How speed advantages translate into edge.",
    category: "strategy-deep-dives",
    minutes: 14,
    free: false,
  },
  {
    slug: "building-a-mean-reversion-model",
    title: "Building a Mean-Reversion Model",
    description: "Design and backtest a simple mean-reversion strategy.",
    category: "strategy-deep-dives",
    minutes: 18,
    free: false,
  },
  {
    slug: "portfolio-level-risk-controls",
    title: "Portfolio-Level Risk Controls",
    description: "Position limits, drawdown guards, and kill switches.",
    category: "strategy-deep-dives",
    minutes: 12,
    free: false,
  },
  {
    slug: "common-connection-errors",
    title: "Common Connection Errors",
    description: "Diagnose the most frequent connectivity issues.",
    category: "troubleshooting",
    minutes: 6,
    free: true,
  },
  {
    slug: "diagnosing-order-rejections",
    title: "Diagnosing Order Rejections",
    description: "Read reject codes and fix the underlying cause.",
    category: "troubleshooting",
    minutes: 9,
    free: false,
  },
  {
    slug: "log-analysis-for-fill-discrepancies",
    title: "Log Analysis for Fill Discrepancies",
    description: "Trace fills through the terminal's logs.",
    category: "troubleshooting",
    minutes: 10,
    free: false,
  },
  {
    slug: "custom-signal-construction",
    title: "Custom Signal Construction",
    description: "Building alpha from microstructure.",
    category: "advanced",
    minutes: 20,
    free: false,
  },
  {
    slug: "execution-tactics-at-scale",
    title: "Execution Tactics at Scale",
    description: "Minimising slippage at scale.",
    category: "advanced",
    minutes: 17,
    free: false,
  },
];
