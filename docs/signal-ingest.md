# Signal ingest (POST /api/signals/ingest/[source])

Status: STARTED at S0.1 (marcus m67424, 2026-10-13), fields added at S0.2 (marcus m67429/m67435), bars and
rulings added at S1 (fable m67474 D5, marcus m67465). The route is NOT BUILT. This file holds what is ruled
for the sender. The full contract (curl line, token generation, responses, the retry rule) is written here
at S2b; until then the design is docs/specs/axiom-signals-dashboard-plan.md section 4.

## Fields per call

| Field | Required | Value |
|---|---|---|
| `symbol` | yes | Axiom's pair name: XAUUSD, US30, EURUSD, GBPUSD, USDJPY, AUDUSD |
| `sessionDate` | yes | Axiom's "date", YYYY-MM-DD. The window is that date 06:00Z to 21:00Z, fixed UTC all year (marcus R2 m67429); the portal derives it, so there is no window field (fable N3 m67474) |
| `direction` | yes | `up`, `down` or `neutral` (marcus R1 m67429) |
| `entryPx` | no; up/down only | OPEN of the 06:00Z hourly bar of the series below; if that bar is missing, the 07:00Z bar's open, then the 08:00Z bar's (axiom via marcus m67465). Optional at registration, set once: send it with the registration post |
| `entryBarTs` | with `entryPx`, and only with it | START of the bar entryPx came from, ISO-8601 UTC: `<sessionDate>T06:00:00Z`, or the 07:00Z / 08:00Z fallback (fable m67474) |
| `exitPx` | no; up/down only, at scoring | CLOSE of the 20:00Z hourly bar (the last bar before 21:00, NOT the 21:00Z bar); if missing, the 19:00Z bar's close, then the 18:00Z bar's (axiom via marcus m67465) |
| `exitBarTs` | with `exitPx`, and only with it | START of the bar exitPx came from, ISO-8601 UTC: `<sessionDate>T20:00:00Z`, or the 19:00Z / 18:00Z fallback (fable m67474) |
| `meta` | no | `{ "source": "card" }` or `{ "source": "backfill: read from market_card_<date>.jpg" }`, Axiom's own string (marcus R8 m67429) |

- Do NOT send an outcome or a move: the portal scores every call itself, with a dead-band Axiom's
  track_record.py does not have, so the two hit rates differ (marcus R4 m67429; fable N2 m67474). Sending
  either field is refused (400). So is `entryTs` or `exitTs` (fable N3 m67474).
- A neutral call carries no prices and no bar times: it is registered and counted, never scored (fable N1
  m67474). A neutral call with entryPx or exitPx is refused (400).
- Refused (400): entryPx without entryBarTs or the reverse; exitPx without exitBarTs or the reverse; a bar
  time outside the window (before 06:00Z, or at or after 21:00Z, of sessionDate); exitPx with no entryPx in
  the same post or already stored (fable N6 m67474).
- The portal records the bar time you send, so a fallback price is visible on its side, not hidden. It also
  records its own clock when entryPx first arrives; an entryPx that first arrives after 21:00Z is shown on
  the page as "entry priced after close" (fable D1 m67474).

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

- Send `entryPx` and `entryBarTs` with the registration post of an up/down call (fable P1 m67410, D5 m67474).
  They can be set once: a later post with a different entryPx or entryBarTs is refused (409). Reason (P1):
  an entry price that arrives after the fact can be chosen, and move is computed from it.
- Once a call is scored, a later post with a different exitPx or exitBarTs is refused (409).
- Send `meta` with the registration post or not at all (fable G2 m67417). meta can be set once, the same
  rule as entryPx: a later post with a different meta is refused (409).
