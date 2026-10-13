# Signal ingest (POST /api/signals/ingest/[source])

Status: STARTED at S0.1 (marcus m67424, 2026-10-13), fields added at S0.2 (marcus m67429/m67435), fable's
mechanics folded at S0.3 (fable m67446). The route is NOT BUILT. This file holds what is ruled for the
sender; items marked TBC are still open. The full contract (curl line, token generation, responses, the
retry rule) is written here at S2b; until then the design is docs/specs/axiom-signals-dashboard-plan.md
section 4.

## Fields per call

| Field | Required | Value |
|---|---|---|
| `symbol` | yes | Axiom's pair name: XAUUSD, US30, EURUSD, GBPUSD, USDJPY, AUDUSD |
| `sessionDate` | yes | Axiom's "date", YYYY-MM-DD. The window is that date 06:00Z to 21:00Z, fixed UTC all year (marcus R2 m67429); the portal derives it from sessionDate (fable R2 m67446) |
| `direction` | yes | `up`, `down` or `neutral` (marcus R1 m67429) |
| `entryTs` / `exitTs` | no | if sent, must equal sessionDate 06:00Z / 21:00Z exactly, else the whole post is refused (400). The sender never chooses the window (fable R2 m67446) |
| `entryPx` | yes to be scored, every direction | the price at the window start, from the series below |
| `exitPx` | at scoring, every direction | the price at the window end, from the series below |
| `meta` | no | `{ "source": "card" }` or `{ "source": "backfill" }`, nothing else for `source` (fable R8 m67446). Axiom's file string "backfill: read from market_card_<date>.jpg" is sent as `backfill` |

- Do NOT send an outcome or a move: the portal is the sole scorer (marcus R4 m67429, confirmed by fable
  m67446). There is no field for either; sending one is refused (400) as an unknown field.
- Neutral calls are priced and scored like up/down: send entryPx and exitPx for them too. The portal stores
  outcome `neutral` for them, and they are never in the hit % (fable R1 m67446).
- Which bar and which field is "the price at the window start / end" (06:00Z bar's open? the 21:00Z bar's
  close? track_record.py:77-79): TBC, asked of Axiom via marcus (plan Q9). Without it nobody can reproduce a
  stored price (fable R3 m67446).
- Prices are kept to 6 decimals; more decimals are rounded at receipt (plan section 4, pending fable's read).

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
| `UNSCORED_AFTER_CLOSE_GRACE_MS` | 2 h | An up/down call first received before its window closed and still unscored 2 h after the close (exit_ts + 2 h < now) is shown as "unscored after close", not "pending". Post the scored form within 2 h of the close. |
| `LEAD_WITHIN_WINDOW_MS` | 15 min | A call first received in the first 15 min after its window opens (entry_ts <= received_at < entry_ts + 15 min) is shown as "within 15 min after open", not "later in window". The other buckets: before open (received_at < entry_ts), later in window (up to exit_ts), after close (received_at >= exit_ts). |

received_at is the portal's own clock at the first receipt of the call, never the sender's. The page's
headline is split by these buckets; `meta.source` is shown beside them as the sender's label (fable R8
m67446).

## Rules for the sender

- Send `entryPx` with the registration post (fable P1 m67410), and only once you hold the bar it comes from
  (fable m67446 call 7). entryPx can be set once: a later post with a different entryPx is refused (409),
  and only a correction by marcus fixes a wrong one. Reason (P1): an entry price that arrives after the fact
  can be chosen, and move is computed from it.
- Send `meta` with the registration post or not at all (fable G2 m67417). meta can be set once, the same
  rule as entryPx: a later post with a different meta is refused (409).
- exitPx can be set once too: a scored call reposted with a different exitPx is refused (409). Reposting the
  same values is always safe and answers "unchanged".
