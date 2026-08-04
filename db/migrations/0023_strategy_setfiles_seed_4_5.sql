-- Seed rows for the paid-tier Setfiles library (strategy_setfiles, see 0021). Covers strategies
-- 4-5 of the 5-strategy launch set (OBI, Grid Arbitrage), resent in full by marcus 2026-08-03
-- after msg 3/3 failed to reach a prior session intact (see 0022 and HANDOFF_setfiles_seed_1_3).
insert into strategy_setfiles (sort_order, strategy_key, source, name, subtitle, explanation, params, session_window, warnings, active)
values
  (
    4,
    'obi',
    'example',
    'Fable starter — Example',
    'OBI — Order Block Imbalance',
    'Analyzes real-time CME Level 2 market depth to identify imbalances between resting buy and sell volume. When one side significantly outweighs the other, enters a trade in the dominant direction. Not a latency-arb strategy — this is genuine order-flow signal trading, closer to what prop desks run on the depth-of-book.',
    $$POSITION SIZING
  Lot Size    = 0.01   — Base lot / contract size per OBI signal.
  Risk %      = 0.05   — Auto-lot risk sizing when Use Risk % is enabled.
  Stop Loss   = 30     — Max adverse move (points) before closing at a loss.
  Take Profit = 25     — Move in your favor (points) before closing at a profit.
  Hard SL     = 300    — Absolute per-trade hard stop in account currency.
  Trail Start = 0      — Inactive for OBI (fixed SL/TP trade management).
  Trail Dist  = 0      — Inactive for OBI.

ADVANCED
  Magic       = 4      — MT5 magic number for order tagging.
  Max Spread  = 60     — Skip signals when broker spread exceeds this (points).
  Min Time(s) = 5      — Minimum hold time per order in seconds.
  Trade Pause = 30     — Waiting time between OBI entries (seconds).
  Imbalance   = 1000   — Minimum contract-volume difference between buy and sell sides to trigger.
  Counter     = 3      — Max opposing signals before the imbalance count resets (noise filter for chop).

FILTERS
  ✓ Use Risk %      — Auto-lot sizing based on Risk % above.
  ✓ Auto Offset     — Auto-adjust broker offset for MT5 execution.
  ☐ Trend Filter    — Optional; OBI is an order-flow signal in its own right.$$,
    '13:30 – 20:00 UTC — CME regular trading hours for equity-index and metals futures; outside RTH, Level 2 depth thins out and imbalance readings become noisy.',
    'Requires the ''Horizon CME'' Fast Feed for Level 2 depth — no other feed provides it. Best-suited instruments are CME futures (ES, NQ, GC, CL); using OBI on non-CME symbols will produce no signals. Imbalance = 1000 is a starter for liquid contracts (ES/NQ); reduce for thinner books (metals, energies) and re-tune per contract.',
    true
  ),
  (
    5,
    'grid',
    'verified',
    'coxwell''s default',
    'Grid Arbitrage — Progressive Basket',
    'The most sophisticated strategy. Uses candle momentum + a trend filter for the initial entry. If price moves against the position, adds new legs at regular intervals with progressively larger volume to average the entry. The entire basket is managed together with shared TP, SL, and trailing stop.',
    $$POSITION SIZING
  Lot Size    = 0.05   — Base lot for the first leg.
  Risk %      = 0.05   — Auto-lot risk sizing (used when Use Risk % is enabled).
  Hard SL     = 2000   — Absolute per-basket hard stop in account currency.
  Trail Start = 80     — Profit level at which the basket trailing stop activates.
  Trail Dist  = 50     — Trailing stop distance behind the highest basket profit.

ADVANCED
  Magic       = 1      — MT5 magic number for order tagging.
  Max Spread  = 60     — Skip new legs when broker spread exceeds this (points).
  Min Time(s) = 5      — Minimum hold time per order in seconds.
  Trade Pause = 30     — Delay between grid actions (seconds).
  Trigger Gap = 60     — Minimum candle body size to open the first position.
  Grid Step   = 40     — Distance (ticks) between grid legs.
  Lot Mult    = 1.4    — Volume multiplier per leg (0.05 → 0.07 → 0.10 → 0.14 → …).
  Max Legs    = 40     — Cap on total open positions in one basket.
  Basket TP   = 800    — Profit target for the entire basket.
  Basket SL   = 1500   — Fixed-price basket stop, measured from first entry.
  Max DD %    = 5      — Basket closes if account drawdown exceeds this %.

FILTERS
  ✓ Use Risk %      — Auto-lot sizing based on Risk % above.
  ✓ Auto Offset     — Auto-adjust broker offset for MT5 execution.
  ✓ Trend Filter    — Only add legs in the trend direction (no counter-trend).
  ☐ Grid Vol.       — (disabled)$$,
    '08:00 – 20:00 UTC (London + NY overlap — prime FX/CFD liquidity, avoids thin Asian-session spreads)',
    'Grid expansion follows the trend filter — no counter-trend legs are added. Basket SL is a fixed price level from the first entry, not a floating P&L value. Stop Loss and Take Profit fields in the terminal are inactive for this strategy (basket-managed).',
    true
  );

insert into schema_migrations (version, name) values
  ('0023', '0023_strategy_setfiles_seed_4_5.sql')
on conflict (version) do nothing;
