# Signal ingest (POST /api/signals/ingest/[source])

Status: STARTED at S0.1 (marcus m67424, 2026-10-13), fields added at S0.2 (marcus m67429/m67435), bars and
rulings added at S1 (fable m67474 D5, marcus m67465), meta.source enum and the repost rules at S1.1 (fable
m67483), the full contract at S2b (marcus m67548: setup, request, answers, retry, limits), the host moved
to horizonone.horizonhft.com (coxwell 17:39Z 2026-10-14 via marcus m68727, rulings m68767). The route is
src/app/api/signals/ingest/[source]/route.ts, the logic src/lib/signal-ingest.ts; the design is
docs/specs/axiom-signals-dashboard-plan.md section 4. The route is NOT LIVE until the setup below is done.

## Setup, in this order

1. **marcus applies** `db/migrations/0110_signal_calls.sql` on prod, then merges (marcus m67548: "0110
   first, then the merge"). With no token hash set, the route answers every request
   `401 {"error":"unauthorized"}`. A preview answers `404 {"error":"not found"}` whatever its env: previews
   share the production database, so a preview must not write. Any host but horizonone.horizonhft.com,
   portal.horizonhft.com included, answers the same 404 (marcus m68767 Q3: hard cutover, no second host).
   The merge comes first and the domain is added after it (m68767), so the route is unreachable until
   **FOC16 adds** horizonone.horizonhft.com to the Vercel project.
2. **Token**, generated on Ubuntu-Axiom; the token itself never leaves that box (not on the bus, not in
   Vercel):
   ```
   umask 077
   openssl rand -base64 32 | tr -d '\n' > <token file>     # 32 random bytes, 44 chars
   sha256sum < <token file> | cut -d' ' -f1                 # prints ONLY the sha256 hex
   ```
   The hash is of the token bytes exactly, no trailing newline. The portal refuses a token under 32 chars.
3. **coxwell sets** `SIGNAL_INGEST_SHA256_AXIOM` = that hash, **Production scope only**, and redeploys.
   `SIGNAL_INGEST_ALLOWED_IP_AXIOM` stays unset (marcus R7 m67429: no static IP for Ubuntu-Axiom); if set,
   any other caller IP gets `403 {"error":"forbidden"}`.

Revoke: blank `SIGNAL_INGEST_SHA256_AXIOM` and redeploy; every request then answers 401. After any
incident, generate a new token (step 2) and set its hash (step 3).

## Request

```
curl -sS -X POST https://horizonone.horizonhft.com/api/signals/ingest/axiom \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $(cat <token file>)" \
  --data-binary @calls.json
```

Body: `{ "source": "axiom", "calls": [ { ...one object per call, fields below... } ] }`. The body's
`source` must equal the source in the path (else 400). Unknown fields are refused (400), at the top level
and in each call.

```
{ "source": "axiom", "calls": [
  { "symbol": "EURUSD", "sessionDate": "2026-10-13", "direction": "up",
    "entryPx": 1.0850, "entryBarTs": "2026-10-13T06:00:00Z", "meta": { "source": "card" } },
  { "symbol": "USDJPY", "sessionDate": "2026-10-13", "direction": "neutral", "meta": { "source": "card" } }
] }
```

The scoring post for the first call, after 21:00Z, sends symbol, sessionDate and direction again, plus the exit fields:
`{ "symbol": "EURUSD", "sessionDate": "2026-10-13", "direction": "up", "exitPx": 1.0862, "exitBarTs": "2026-10-13T20:00:00Z" }`.

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
| `meta` | no | `{ "source": "card" }` or `{ "source": "backfill" }`, nothing else for `source` (fable R8 m67446, kept m67483). Axiom's file string "backfill: read from market_card_<date>.jpg" is sent as `backfill`; any other `source` value is refused (400) |

- Do NOT send an outcome or a move: the portal scores every call itself, with a dead-band Axiom's
  track_record.py does not have, so the two hit rates differ (marcus R4 m67429; fable N2 m67474). Sending
  either field is refused (400). So is `entryTs` or `exitTs` (fable N3 m67474).
- A neutral call carries no prices and no bar times: it is registered and counted, never scored (fable N1
  m67474). A neutral call with entryPx or exitPx is refused (400).
- Refused (400): entryPx without entryBarTs or the reverse; exitPx without exitBarTs or the reverse; a bar
  time outside the window (before 06:00Z, or at or after 21:00Z, of sessionDate); exitPx with no entryPx in
  the same post or already stored (fable N6 m67474).
- Prices are JSON numbers, positive (a string such as `"1.0850"` is refused, 400; fable m67547 call 9).
  Bar times carry seconds: `2026-10-13T06:00:00Z`, milliseconds optional; `2026-10-13T06:00Z` is refused
  (400; fable m67547 call 8).
- The portal records the bar time you send, so a fallback price is visible on its side, not hidden. It also
  records its own clock when entryPx first arrives; on a LIVE call (one the portal first received before
  21:00Z of its sessionDate), an entryPx that first arrives at or after 21:00Z is shown on the page as "entry
  priced after close" (fable D1 m67474; LIVE qualifier fable N1 m67501, plan section 5). A backfilled call
  (first received at or after 21:00Z) is not in that count.

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

Both are named constants in src/lib/signal-stats.ts (S3) and are shown in the page's method note (S4, not built yet).
Values set by marcus m67424 ("I accept fable's proposal as-is"), proposed by fable m67417 (G5).

| Constant | Value | Meaning |
|---|---|---|
| `UNSCORED_AFTER_CLOSE_GRACE_MS` | 2 h | An up/down call first received before its window closed and still unscored 2 h after the close (exit_ts + 2 h < now) is shown as "unscored after close", not "pending". Post the scored form within 2 h of the close. |
| `LEAD_WITHIN_WINDOW_MS` | 15 min | A call first received in the first 15 min after its window opens (entry_ts <= received_at < entry_ts + 15 min) is shown as "within 15 min after open", not "later in window". The other buckets: before open (received_at < entry_ts), later in window (up to exit_ts), after close (received_at >= exit_ts). |

received_at is the portal's own clock at the first receipt of the call, never the sender's. The page's
headline is split by these buckets; `meta.source` is shown beside them as the sender's label (fable R8
m67446, kept m67483).

## Rules for the sender

- Send `entryPx` and `entryBarTs` with the registration post of an up/down call (fable P1 m67410, D5 m67474),
  and only once you hold the bar it comes from (fable m67446 call 7, kept m67483). They can be set once: a
  later post with a different entryPx or entryBarTs is refused (409), and only a correction by marcus fixes a
  wrong one. Reason (P1): an entry price that arrives after the fact can be chosen, and move is computed
  from it.
- Once a call is scored, a later post with a different exitPx or exitBarTs is refused (409).
- Prices are kept to 6 decimals, rounded at receipt, and a repost is compared at those 6 decimals (fable A1
  m67483): a repost of the same price with a 7th decimal answers "unchanged", not 409. Reposting the same
  values is always safe and answers "unchanged".
- Send `meta` with the registration post or not at all (fable G2 m67417). meta can be set once, the same
  rule as entryPx: a later post with a different meta is refused (409).

## Answers

Every answer the handler gives is JSON with `cache-control: no-store`. A failure to get a database
connection is the 500 below, with its body and the server log line `signal-ingest: failed <source> <name>
<message>` (S2b.1, fable m67577 call 1; at 6f3af9d it was a 5xx with no body and no log line).

| Code | Body | Meaning |
|---|---|---|
| 200 | `{ "inserted", "scored", "filled", "unchanged" }` | Every call applied, in one transaction. Each call is in exactly one count (fable m67547 call 1): `inserted` = a new call (a new call sent with both prices is scored in the same write and still counts here); `scored` = a stored call given its exitPx (and its entryPx, if that comes in the same post); `filled` = a stored call given its entryPx or meta, not scored; `unchanged` = nothing new |
| 400 | `{ "error" }`, plus `index` when one call caused it, and `symbol` for an unknown symbol | The body is refused, NOTHING is written. The first bad call in index order is the one named (fable m67547 call 6). Also used for a wrong content-type and a body over the cap (call 3) |
| 401 | `{ "error": "unauthorized" }` | Bad or missing token, OR an unknown or unconfigured source: one body for all (fable C2 m67410) |
| 403 | `{ "error": "forbidden" }` | IP rule set and the caller is not that IP (not set for axiom) |
| 404 | `{ "error": "not found" }` | Not production, or not the horizonone.horizonhft.com host |
| 409 | `{ "error", "index" }` | Call `index` conflicts with the stored call (the 409 lines in the rules above, or a changed direction). The WHOLE batch is rolled back, calls before `index` too |
| 500 | `{ "error": "internal error; nothing was written" }` | The database could not be reached, or the transaction failed and was rolled back |

Calls in one POST are applied in index order, so a later call sees an earlier one: the same key twice
with the same values answers 1 inserted + 1 unchanged, and a registration in call 0 with its exit in call 1
answers 1 inserted + 1 scored (fable m67547 call 5, probed on her side).

## Retry

- 200: done. Nothing to resend.
- Any 5xx, a timeout, or no answer at all: resend the SAME body. Any POST is safe to repeat: the same key with
  the same values answers "unchanged", so a call that was in fact written before the connection dropped is
  not written twice (plan section 4, Retry).
- 400 or 409: do not resend the same body; it will get the same answer. A 409 on a set entryPx, entryBarTs
  or meta, or on a scored call's exitPx or exitBarTs, is fixed only by marcus's correction SQL.
- 401, 403, 404: setup, not data. Stop and report; do not loop.

## Limits

- 1 to 200 calls per POST, body at most 64 KB (65,536 bytes of UTF-8). Over either: 400, nothing written.
- A backfill is a loop of POSTs. Chunk by bytes AS WELL AS by count: close a chunk at 200 calls or before
  the next call would take the body past 64 KB, whichever comes first (fable N4 m67547: 200 calls with a
  40-char meta note measured 52,428 B on her side, so a meta past about 100 B per call reaches 64 KB before
  200 calls).
