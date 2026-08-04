-- Seed rows for the paid-tier Setfiles library (strategy_setfiles, see 0021). Covers strategies
-- 1-3 of the 5-strategy launch set (1 LEG, 2 LEG LOCK, Trend Impulse), resent by marcus 2026-08-03
-- after msg 3/3 (seeds 4-5: OBI, Grid) failed to reach this agent intact -- only a truncated log
-- preview survived locally, so those two are NOT seeded here. See HANDOFF for the resend ask.
insert into strategy_setfiles (sort_order, strategy_key, source, name, subtitle, explanation, params, session_window, warnings, active)
values
  (
    1,
    '1leg',
    'example',
    'Fable starter — conservative',
    '1 LEG — Latency Arbitrage',
    'Detects when the Fast Feed price moves ahead of the Broker price and opens a trade on the slower broker in the direction of the gap, closing when the broker catches up. The cleanest latency-arb primitive — small, fast, one-sided trades that rely purely on the feed-vs-broker time lag.',
    $$POSITION SIZING
  Lot Size    = 0.01   — Base lot for the single leg (demo-safe starter).
  Risk %      = 0.05   — Auto-lot risk sizing when Use Risk % is enabled.
  Stop Loss   = 20     — Max adverse move (points) before the trade closes at a loss.
  Take Profit = 15     — Move in your favor (points) before closing at a profit.
  Hard SL     = 200    — Absolute per-trade hard stop in account currency.
  Trail Start = 0      — Inactive for 1 LEG (single-leg strategy, no basket trail).
  Trail Dist  = 0      — Inactive for 1 LEG.

ADVANCED
  Magic       = 1      — MT5 magic number for order tagging.
  Max Spread  = 60     — Skip signals when broker spread exceeds this (points).
  Min Time(s) = 5      — Minimum hold time per order in seconds.
  Trade Pause = 30     — Waiting time between trades (seconds) — prevents rapid-fire re-entries.
  Gap         = 30     — Minimum Fast-Feed vs Broker price difference (points) to trigger. Higher = fewer, cleaner entries.
  Shift       = 5      — Entry-price offset (points) to compensate for execution delay.

FILTERS
  ✓ Use Risk %      — Auto-lot sizing based on Risk % above.
  ✓ Auto Offset     — Auto-adjust broker offset for MT5 execution.
  ☐ Trend Filter    — Optional; enable to only take gaps aligned with the EMA trend.$$,
    '08:00 – 20:00 UTC — London + NY overlap, deepest liquidity and tightest broker spreads for FX majors.',
    'Requires a fast, low-latency broker connection and a Fast Feed noticeably quicker than the broker. B-book brokers may flag and slow-execute latency-arb flow — test on demo first, and use the Order Flow Profile panel to blend algorithmic and discretionary tagging when going live.',
    true
  ),
  (
    2,
    '2leg_lock',
    'example',
    'Fable starter — conservative',
    '2 LEG LOCK — Hedge Arbitrage',
    'On gap detection, opens both a BUY and a SELL simultaneously. The losing leg is closed quickly, and a trailing stop is applied to the winner to lock profit. Reduces directional risk on entry — the hedge itself is the "insurance" while the feed advantage plays out.',
    $$POSITION SIZING
  Lot Size    = 0.01   — Base lot for EACH leg (total exposure = 2× this).
  Risk %      = 0.05   — Auto-lot risk sizing when Use Risk % is enabled.
  Stop Loss   = 40     — Max loss (points) on each individual leg before forced closure.
  Take Profit = 0      — Inactive — winner is managed by Trail Start / Trail Dist.
  Hard SL     = 300    — Absolute per-basket hard stop in account currency.
  Trail Start = 50     — Profit (points) on the winning leg before trailing stop activates.
  Trail Dist  = 30     — Trailing stop distance (points) behind the winning leg's peak.

ADVANCED
  Magic       = 2      — MT5 magic number for order tagging (distinct from other tabs).
  Max Spread  = 60     — Skip signals when broker spread exceeds this (points).
  Min Time(s) = 5      — Minimum hold time per order in seconds.
  Trade Pause = 30     — Delay between hedge entries (seconds).
  Gap         = 30     — Minimum Fast-Feed vs Broker price difference (points) to trigger simultaneous entry.

FILTERS
  ✓ Use Risk %      — Auto-lot sizing based on Risk % above.
  ✓ Auto Offset     — Auto-adjust broker offset for MT5 execution.
  ☐ Trend Filter    — Not recommended for hedge entries (both directions open by design).$$,
    '08:00 – 20:00 UTC — London + NY overlap; avoid rollover (21:00-22:00 UTC) when spreads widen and hedges can whipsaw.',
    'Requires a hedge-enabled broker. NOT supported on Rithmic or on FIFO-compliant US brokers — 2 LEG LOCK will refuse to arm on those accounts. Double margin usage compared to 1 LEG (two legs open simultaneously) — size Lot Size accordingly.',
    true
  ),
  (
    3,
    'trend_impulse',
    'example',
    'Fable starter — conservative',
    'Trend Impulse — Fast-Feed Momentum',
    'Monitors the Fast Feed for sudden, sharp price movements within a very short time window. When a strong directional impulse is detected, opens a trade on the broker in the same direction before the broker''s feed catches up. Complements 1 LEG — 1 LEG trades static gaps; Trend Impulse trades velocity.',
    $$POSITION SIZING
  Lot Size    = 0.01   — Base lot per impulse trade.
  Risk %      = 0.05   — Auto-lot risk sizing when Use Risk % is enabled.
  Stop Loss   = 25     — Max adverse move (points) before closing at a loss.
  Take Profit = 20     — Move in your favor (points) before closing at a profit.
  Hard SL     = 250    — Absolute per-trade hard stop in account currency.
  Trail Start = 0      — Inactive for Trend Impulse (short-duration single-leg trades).
  Trail Dist  = 0      — Inactive for Trend Impulse.

ADVANCED
  Magic       = 3      — MT5 magic number for order tagging.
  Max Spread  = 60     — Skip signals when broker spread exceeds this (points).
  Min Time(s) = 5      — Minimum hold time per order in seconds.
  Trade Pause = 30     — Waiting time between impulse trades (seconds).
  Trend Gap   = 50     — Minimum Fast-Feed price movement (points) to qualify as an impulse.
  Trend Time  = 200    — Time window (ms) the Trend Gap must occur within. Shorter = only sharp spikes.

FILTERS
  ✓ Use Risk %      — Auto-lot sizing based on Risk % above.
  ✓ Auto Offset     — Auto-adjust broker offset for MT5 execution.
  ✓ Trend Filter    — Optional EMA alignment to filter counter-trend impulses.$$,
    '07:00 – 17:00 UTC — London open + NY morning; news-driven impulses cluster here. Avoid pre-news blackout minutes.',
    'Very sensitive to Fast Feed quality — a laggy or jittery feed will produce false impulses. Around scheduled news (NFP, CPI, FOMC) the broker often widens spreads and rejects fast entries; consider pausing the tab during red-flag events. Best tested first on EURUSD or XAUUSD where Fast Feed depth is strongest.',
    true
  );

insert into schema_migrations (version, name) values
  ('0022', '0022_strategy_setfiles_seed_1_3.sql')
on conflict (version) do nothing;
