# Signal ingest (POST /api/signals/ingest/[source])

Status: STARTED at S0.1 (marcus m67424, 2026-10-13), fields added at S0.2 (marcus m67429/m67435). The
route is NOT BUILT. This file holds what is ruled or proposed for the sender; items marked PROPOSED wait on
fable's read. The full contract (curl line, token generation, responses, the retry rule) is written here
at S2b; until then the design is docs/specs/axiom-signals-dashboard-plan.md section 4.

## Fields per call (S0.2)

| Field | Required | Value |
|---|---|---|
| `symbol` | yes | Axiom's pair name: XAUUSD, US30, EURUSD, GBPUSD, USDJPY, AUDUSD |
| `sessionDate` | yes | Axiom's "date", YYYY-MM-DD. The window is that date 06:00Z to 21:00Z, fixed UTC all year (marcus R2 m67429); the portal derives it (PROPOSED), so there is no window field |
| `direction` | yes | `up`, `down` or `neutral` (marcus R1 m67429) |
| `entryPx` | up/down only | the price at the window start, from the series below |
| `exitPx` | up/down only, at scoring | the price at the window end, from the series below |
| `meta` | no | `{ "source": "card" }` or `{ "source": "backfill: read from market_card_<date>.jpg" }`, Axiom's own string (marcus R8 m67429) |

- Do NOT send an outcome or a move: the portal scores every call itself, with a dead-band Axiom's
  track_record.py does not have, so the two hit rates differ (marcus R4 m67429; PROPOSED until fable
  confirms). Sending either field is refused (400).
- A neutral call carries no prices (PROPOSED): it is registered and counted, never scored.
- Which bar field is "the price at the window start / end" is NOT YET WRITTEN here (plan Q9).

## Price series (marcus R3 m67429; Axiom's track_record.py:33-40 via m67429)

Prices come from the same Yahoo series Axiom scores with. Gold and the Dow are FUTURES prices, not spot.

| symbol | Yahoo ticker |
|---|---|
| XAUUSD | GC=F |
| US30 | YM=F |
| EURUSD | EURUSD=X |
| GBPUSD | GBPUSD=X |
| USDJPY | JPY=X |
| AUDUSD | AUDUSD=X |

## Timing values

Both are named constants in src/lib/signal-stats.ts (not built yet) and are shown in the page's method note.
Values set by marcus m67424 ("I accept fable's proposal as-is"), proposed by fable m67417 (G5).

| Constant | Value | Meaning |
|---|---|---|
| `UNSCORED_AFTER_CLOSE_GRACE_MS` | 2 h | A call still unscored 2 h after its window closes (exit_ts + 2 h < now) is shown as "unscored after close", not "pending". Post the scored form within 2 h of the close. |
| `LEAD_WITHIN_WINDOW_MS` | 15 min | A call first received in the first 15 min after its window opens (entry_ts <= received_at < entry_ts + 15 min) is shown as "within 15 min after open", not "later in window". The other buckets: before open (received_at < entry_ts), later in window (up to exit_ts), after close (received_at >= exit_ts). |

received_at is the portal's own clock at the first receipt of the call, never the sender's.

## Rules for the sender

- Send `entryPx` with the registration post of an up/down call (fable P1 m67410). entryPx can be set once: a later post with a
  different entryPx is refused (409). Reason (P1): an entry price that arrives after the fact can be chosen,
  and move is computed from it.
- Send `meta` with the registration post or not at all (fable G2 m67417). meta can be set once, the same
  rule as entryPx: a later post with a different meta is refused (409).
