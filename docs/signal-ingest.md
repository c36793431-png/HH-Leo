# Signal ingest (POST /api/signals/ingest/[source])

Status: STARTED at S0.1 (marcus m67424, 2026-10-13). The route is NOT BUILT. This file holds only what is
already ruled for the sender. The full contract (curl line, token generation, field names, responses, the
retry rule) is written here at S2b; until then the design is
docs/specs/axiom-signals-dashboard-plan.md section 4.

## Timing values

Both are named constants in src/lib/signal-stats.ts (not built yet) and are shown in the page's method note.
Values set by marcus m67424 ("I accept fable's proposal as-is"), proposed by fable m67417 (G5).

| Constant | Value | Meaning |
|---|---|---|
| `UNSCORED_AFTER_CLOSE_GRACE_MS` | 2 h | A call still unscored 2 h after its window closes (exit_ts + 2 h < now) is shown as "unscored after close", not "pending". Post the scored form within 2 h of the close. |
| `LEAD_WITHIN_WINDOW_MS` | 15 min | A call first received in the first 15 min after its window opens (entry_ts <= received_at < entry_ts + 15 min) is shown as "within 15 min after open", not "later in window". The other buckets: before open (received_at < entry_ts), later in window (up to exit_ts), after close (received_at >= exit_ts). |

received_at is the portal's own clock at the first receipt of the call, never the sender's.

## Rules for the sender

- Send `entryPx` with the registration post (fable P1 m67410). entryPx can be set once: a later post with a
  different entryPx is refused (409). Reason (P1): an entry price that arrives after the fact can be chosen,
  and move is computed from it.
- Send `meta` with the registration post or not at all (fable G2 m67417). meta can be set once, the same
  rule as entryPx: a later post with a different meta is refused (409).
