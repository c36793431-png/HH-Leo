/** The symbols a signal source may post, and how each is scored (Axiom signals dashboard S2a; plan
 * docs/specs/axiom-signals-dashboard-plan.md section 4 "signal-instruments" at 0e61f2c, table at :305-312).
 * A symbol not in this map is refused by the ingest (400, whole batch; fable P5(b) m67410, G4 m67417): with no
 * unit and no dead-band it could never be scored.
 *
 * - yahooTicker: the Yahoo series Axiom prices from (axiom m67428 via marcus m67429, track_record.py :33-40, not
 *   read by me). XAUUSD and US30 are FUTURES (GC=F, YM=F), not spot (R3 m67429).
 * - unit: the price size of one move unit (one pip for FX, so no separate pip size; fable m67483).
 * - band: the dead-band in move units; |move| strictly under it is FLAT. Values are marcus's (m67429).
 * - bandInt: the band in price * 1e6 integers, WRITTEN OUT as a literal (fable m67483). The ingest compares
 *   this integer, never a float product. signal-ingest.test.ts asserts bandInt === band * unit * 1e6 per row,
 *   so the two cannot drift.
 * - label: the page's word for one move unit. */
export interface SignalInstrument {
  yahooTicker: string;
  unit: number;
  band: number;
  bandInt: number;
  label: "pips" | "$" | "points";
}

export const SIGNAL_INSTRUMENTS: Readonly<Record<string, SignalInstrument>> = {
  EURUSD: { yahooTicker: "EURUSD=X", unit: 0.0001, band: 5, bandInt: 500, label: "pips" },
  GBPUSD: { yahooTicker: "GBPUSD=X", unit: 0.0001, band: 5, bandInt: 500, label: "pips" },
  AUDUSD: { yahooTicker: "AUDUSD=X", unit: 0.0001, band: 5, bandInt: 500, label: "pips" },
  USDJPY: { yahooTicker: "JPY=X", unit: 0.01, band: 5, bandInt: 50000, label: "pips" },
  XAUUSD: { yahooTicker: "GC=F", unit: 1.0, band: 2, bandInt: 2000000, label: "$" },
  US30: { yahooTicker: "YM=F", unit: 1.0, band: 20, bandInt: 20000000, label: "points" },
};

export function signalInstrument(symbol: string): SignalInstrument | undefined {
  return Object.hasOwn(SIGNAL_INSTRUMENTS, symbol) ? SIGNAL_INSTRUMENTS[symbol] : undefined;
}
