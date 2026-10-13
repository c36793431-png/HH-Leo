# Axiom signals dashboard: plan (PLAN ONLY, no code until marcus's named GO per slice)

Job: marcus m67349 (2026-10-13 17:35Z, room axiom-dashboard-2026-10-13), from coxwell 17:3xZ.
Branch: kai/axiom-signals-dashboard-2026-10-13, off main 544f6fc. Reviewer: fable. Author: kai.

Revision S0.1 (doc only, on 8909f17; marcus named GO m67424 18:20Z): folds in fable's review m67410 (18:08Z,
P1-P5 + the 422 ruling) and her answers to my gaps m67417 (18:14Z, G1-G5), and marcus's G5 values (m67424).
Each changed rule below names the message it comes from.

Revision S0.2 (doc only, on 5abac28; marcus m67435 18:24Z): folds in Axiom's answers and marcus's product
rulings R1-R8 (m67429 18:22Z). Fable reads 5abac28 + S0.2 as one doc (m67435). S1 GO attaches to fable's
PASS of this doc (m67429, m67435); Q4 is answered (no 4H bars), so nothing else holds S1.

Revision S1 (code + doc, on 5f14a38; fable m67474 18:37Z, PASS WITH CHANGES of S0.2 7eb9a73, "no S0.3; S1 ships
0110 with schema deltas D1-D3 and doc deltas D4-D8 in the same push"). m67474 was written against 7eb9a73 and
amends fable's own m67446, which S0.3 5f14a38 had folded. So this file and docs/signal-ingest.md were first
restored byte-for-byte to 7eb9a73 (the text fable read and passed) and then given D4-D8; the S0.3 text is not
carried. Diff for review: 7eb9a73..S1 on the two docs. Rulings folded: N1 (neutral never scored), N2, N3
(entryTs/exitTs unknown fields), N4 (integer arithmetic), N5 (headline split on received_at), N6, P3, Q9
mechanics (bar-ts columns), D1 (entry_px_at), and marcus m67465 (Axiom's bars, relayed).

Revision S1.1 (doc only, on 6b10fb4): folds in fable m67483 (copy to marcus m67478, 18:40Z, room
axiom-dashboard), her read of S0.3 5f14a38, written before she had 6b10fb4. Her REVERT list matched what S1
already restored from 7eb9a73. This revision carries the S0.3 items she KEEPS (meta.source enum, the shared
received_at vs exit_ts comparison and its two edge tests, call 6 test scope, call 7 line, 409 on a differing
stored price, the retired 422 text) and her rulings on my m67467 A1-A3 (A1 6-dp storage and the scaled-integer
repost compare, A2 the outcome-null partition, A3 the four-row headline with two subtotals; A4 MOOT). Diff for
review stays 7eb9a73..S1.1 on the two docs. No SQL or test file changes.

Everything below about the repo was read at 544f6fc. Nothing about Ubuntu-Axiom was read by me:
predictions.jsonl and track_record.py are on a box I cannot reach. Every statement about them is axiom's
reply m67428 (18:22Z, quoted from its own files) as relayed by marcus m67429, cited "track_record.py:NN
(axiom m67428 via marcus m67429)". Those line numbers are axiom's, not checked by me.

### What Axiom's files say (axiom m67428 via marcus m67429)

- predictions.jsonl: one line per DATE, `{"date":"YYYY-MM-DD","pairs":[{"pair":SYM,"direction":"up"|"down"|"neutral"}],"source":"card" | "backfill: read from market_card_<date>.jpg"}`.
  load_history() keys on date; the LAST write for a date wins (:52). No prices in the file.
- Symbols (:33-40): XAUUSD -> GC=F, US30 -> YM=F (futures: spot does not trade the whole window),
  EURUSD -> EURUSD=X, GBPUSD -> GBPUSD=X, USDJPY -> JPY=X, AUDUSD -> AUDUSD=X.
- Scoring: Yahoo chart API hourly bars (interval=1h, range=3mo, :66-79), fetched live, nothing cached.
  Window START_H, END_H = 6, 21, fixed UTC all year (:41, :77). Hit = end > start for up, end < start for
  down, strict (:108). No pip or point sizes, no dead-band. Neutral calls skipped before scoring (:102).
  Hit % = hits / scored up+down calls; neutrals not in the denominator (:118-124).
- Bars (Q9, axiom m-18:31Z via marcus m67465, track_record.py day_move() :84-87, not read by me): start =
  OPEN of the 06:00Z hourly bar, fallback 07:00Z then 08:00Z; end = CLOSE of the 20:00Z bar (the last bar
  before 21:00, not the 21:00Z bar), fallback 19:00Z then 18:00Z. Bars with a null open/close are dropped
  (:75-76); if all three fallbacks miss, day_move() returns None and the call is skipped silently (:104-106).

## 1. Transport: PUSH (Axiom POSTs to a token-auth ingest route). Not pull.

Why push:
- Timing is evidence. A call row stamped `received_at` by the portal before the session opens is proof
  the call was not written after the move. Push lets Axiom register each call when it is made and score
  it after 21:00; a pull only learns of a call when the poll runs. (Section 3, `received_at`.)
- The portal runs on Vercel. A pull needs a URL Vercel can reach, so Axiom would have to publish the calls
  somewhere public, then that URL needs its own auth: the same token problem, plus a host to run.
- The repo already has the push shape, reviewed: src/lib/agent-api.ts:105-123 `gateAgentRequest`
  (production only, sha256 of the bearer token held in env, compared with timingSafeEqual, strict body,
  byte cap). The ingest gate copies that shape; it does not import agent-api (different env, no IP rule
  by default, see 4).
- A pull would also need a scheduled job. NOT VERIFIED here: the Hobby-plan cron limits (vendor docs
  cannot be read from this box). Push needs no schedule on the portal side.

Cost of push: Axiom needs a small poster (curl or python, about 30 lines) and a retry on failure. The ingest
is idempotent (section 4), so a retry is always safe.

Q6 (axiom m67428 via marcus m67429): a POST at call time (~06:10Z card) and one after 21:00 scoring is
feasible with the urllib it already uses. Not built. Outbound from Ubuntu-Axiom to a new host is UNVERIFIED
(its own bus POST hit a network wall that turn). The poster and backfill come later and need FOC17 for
outbound network; not this week's blocker (marcus m67429).

## 2. Migration number: 0110 (ASKED, not claimed)

- main 544f6fc tops out at 0107. 0107's own header (db/migrations/0107_bundle_subscriptions.sql:17) names
  0108 ('nova'). The bus (newest ~1000 messages, read 2026-10-13) has 0108 = nova schema, 0109 = nova
  backfill. No 0110 or 0111 on the bus.
- `git log --all` over db/migrations/0103*, 0108*, 0109*, 011* after a fetch on 2026-10-13: no such file on
  any branch, local or remote.
- So 0110 is the first number free on every branch and in the bus window. marcus confirms it before S1.

## 3. Schema (0110_signal_calls.sql, additive, one new table, no change to any existing table)

```sql
create table if not exists signal_calls (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source ~ '^[a-z][a-z0-9-]{1,31}$'),   -- 'axiom' now; 'sentiment', 'cot' later
  symbol text not null check (symbol ~ '^[A-Z0-9]{3,12}$'),         -- 'EURUSD', 'XAUUSD', 'US30'
  session_date date not null,
  direction text not null check (direction in ('up', 'down', 'neutral')),   -- Axiom's words (R1 m67429)
  entry_ts timestamptz not null,                                    -- window start (session_date 06:00Z for Axiom)
  exit_ts timestamptz not null,                                     -- window end (session_date 21:00Z for Axiom)
  entry_px numeric,                                                 -- fill-only; required once scored (stamp)
  entry_px_at timestamptz,                                          -- D1: portal clock when entry_px first fills; never sent
  entry_bar_ts timestamptz,                                         -- Q9: START of the bar entry_px came from, as sent
  exit_px numeric,
  exit_bar_ts timestamptz,                                          -- Q9: START of the bar exit_px came from, as sent
  move numeric,          -- signed, in the symbol's unit (signal-instruments), + = in the call's favour
  outcome text check (outcome in ('right', 'wrong', 'flat')),
  meta jsonb,                                                       -- fill-only; source-specific: confidence, card id, ...
  received_at timestamptz not null default now(),                   -- first receipt; never rewritten
  scored_at timestamptz,                                            -- first receipt of the scored form
  updated_at timestamptz not null default now(),
  constraint signal_calls_window check (exit_ts > entry_ts),
  constraint signal_calls_entry_stamp check (
    ((entry_px is null) = (entry_px_at is null)) and ((entry_px is null) = (entry_bar_ts is null))
  ),
  constraint signal_calls_scored_stamp check (
    ((outcome is null) = (exit_px is null)) and ((outcome is null) = (move is null))
    and ((outcome is null) = (scored_at is null)) and ((outcome is null) = (exit_bar_ts is null))
    and (outcome is null or entry_px is not null)
  ),
  constraint signal_calls_neutral_unscored check (
    direction <> 'neutral' or (entry_px is null and exit_px is null and outcome is null)
  ),
  constraint signal_calls_one_per_window unique (source, symbol, entry_ts)
);
create index if not exists signal_calls_source_date_idx on signal_calls(source, session_date);
```

Plus the schema_migrations ledger row, begin/commit, and 0110_rollback.sql (drop table, which drops the
trigger with it; the rollback also drops the trigger function) as 0105/0107 do. Like 0105/0107's rollbacks it
refuses while the table has rows (my call at S1): received_at, entry_px_at and scored_at cannot be re-created by
re-posting.
The stamp CHECKs are conjoined equalities, not `a = b = c` (0107:9 note).

Entry stamp and bar stamps (fable D1 + Q9 mechanics, m67474):
- entry_px_at is the portal's clock (now()) in the statement that first fills entry_px; the sender never sends
  it. P1 froze the entry VALUE; entry_px_at records WHEN it arrived, because with three fallback bars a sender
  could register at 06:10Z without entryPx and pick among the 06/07/08 opens after 21:00 while received_at
  still reads "within 15 min". Symmetric to scored_at for exit_px.
- entry_bar_ts / exit_bar_ts are the START of the hourly bar the price came from, as sent (06:00Z, or the
  07:00Z/08:00Z fallback; 20:00Z, or the 19:00Z/18:00Z fallback). Columns, not meta: meta is fill-only at
  registration and the exit bar arrives at close, and a fallback must be queryable for any source.
- signal_calls_entry_stamp: entry_px, entry_px_at and entry_bar_ts are all null or all set. exit_bar_ts is
  in signal_calls_scored_stamp.

Neutral calls (R1 m67429: registered, shown, excluded from hit %). RULED (fable N1 m67474, my S0.2 shape):
- A neutral row is a registration that is never scored: no prices, outcome null forever
  (signal_calls_neutral_unscored; with the two stamps that also forces entry_px_at, both bar stamps, move
  and scored_at null). The outcome enum stays right/wrong/flat.
- The ingest refuses a neutral call that carries entryPx or exitPx (400, whole batch, index named), the same
  as any other malformed call. Axiom has no prices for them anyway: its scorer skips neutrals before it
  fetches anything (:102).
- The page counts neutral by direction, never by outcome, so a neutral row is never "pending" and never
  "unscored after close" (section 5). It does get a lead-time bucket: when it was registered is still
  evidence.
- Cost, stated by fable (m67474): "market stayed in band on neutral days" needs a later migration (relax the
  CHECK + a stamp arm). Backlog, not derivable from this table.

Trigger (fable P2 m67410, G1/G2 m67417, D2/D3 m67474): one plpgsql function `signal_calls_guard_update()` +
BEFORE UPDATE trigger `signal_calls_guard` on signal_calls, in 0110. It raises on any UPDATE that breaks one of
three column families:

| Family | Columns | Rule |
|---|---|---|
| NEVER | source, symbol, entry_ts, exit_ts, session_date, direction, received_at | never changes |
| FILL-ONLY | entry_px, entry_px_at, entry_bar_ts, meta | may go null -> value; once old value is not null it never changes (regardless of outcome) |
| FROZEN-ONCE-SCORED | exit_px, exit_bar_ts, move, outcome, scored_at | never changes once old.outcome is not null |

- All three families bypass only when `current_setting('signal_calls.allow_correction', true) = 'on'`, so a
  correction SQL file from marcus does `set local signal_calls.allow_correction = 'on'` inside its
  transaction; no trigger disable. DELETE is not blocked (rollback and corrections).
- updated_at is in no family.
- The ingest's own updates pass the trigger by construction: the fill statement (entry_px + entry_px_at +
  entry_bar_ts, one statement) and the register-then-score statement (the five scored columns, one
  statement), each null -> value.
- pglite runs plpgsql: VERIFIED by fable (m67417: PGlite 0.4.6, Node 20, refuse + `set local` bypass both
  worked). NOT run by me.
- meta was `not null default '{}'` at 8909f17. FILL-ONLY means "set when null" (G2), which a not-null column
  never is, so S0.1 makes meta nullable with no default: a call posted without meta stores null. This is my
  change, made to keep G2's rule literal; CONFIRMED (call 1, fable m67474).

Choices for fable:
- C1 Unique key (source, symbol, entry_ts), not (source, symbol, session_date): the same table then takes
  an intraday or weekly source (COT is weekly) without a migration. Axiom's daily card is one window a day
  per symbol, so for Axiom the two keys are the same thing.
- C2 Multi-source: `source` is a format CHECK in SQL and an allowlist in code (ingest, section 4). Adding a
  source = a reviewed commit plus one env var, no migration. Anything a source has that the shared columns do
  not (sentiment score, confidence, COT net position) goes in `meta`; the page reads only shared columns.
- C3 A row can exist unscored: Axiom can register the call at call time (outcome null) and score it later
  (section 4). If Axiom only ever posts scored rows, nothing breaks; the page then puts every call in the
  "after close" lead-time bucket (section 5), which is accurate. Fable PASS with P1 (entry_px fill-only) and
  P3 (the "unscored after close" bucket) (m67410).
- C4 Immutability: the ingest code refuses (409) AND the 0110 trigger above refuses the same changes (fable
  m67410 C4 + P2: a 409 in one route protects the evidence columns only against that route). Corrections
  are a SQL file to marcus (CLAUDE.md rule 4) using the allow_correction setting.

Not in 0110: price bars. Q4 answered no (axiom m67428: no 4H bars, only live Yahoo hourlies, nothing
cached), so no signal_bars table (R6 m67429). S5 is the price line through each call's own entry/exit.

- R5 (m67429): predictions.jsonl is last-write-wins per date (:52), so a day can be rewritten on Axiom's
  side. That is why C4 stays: a rewritten day reaching the ingest gets 409 on the changed NEVER column
  (direction), never an overwrite.

## 4. Ingest: POST /api/signals/ingest/[source]

- Route file src/app/api/signals/ingest/[source]/route.ts (fable P5(a) m67410; path accepted m67417), logic in
  src/lib/signal-ingest.ts (testable without Next). The source is in the PATH so the gate picks its env var
  before the body is read; at 8909f17 it came from the body, which put JSON parsing before auth.
- proxy.ts matcher excludes /api (src/proxy.ts:172), so the route's own gate is the only gate.
- Each source has its own env var holding the sha256 hex of its token, e.g. `SIGNAL_INGEST_SHA256_AXIOM`;
  code map `{ axiom: "SIGNAL_INGEST_SHA256_AXIOM" }`. A token is bound to its source: the axiom token cannot
  write sentiment rows. The token is generated on Ubuntu-Axiom; only its sha256 goes into Vercel env.
- Gate, in this order (fable m67417, "S0.1 states it as that list so S1's tests map 1:1"); each step runs only
  if every step above it passed:
  1. `VERCEL_ENV !== "production"` -> 404. Previews share the production DB, so a preview must not write.
  2. Path source fails `^[a-z][a-z0-9-]{1,31}$`, OR is not in the code map, OR its env var is missing or not
     64 hex chars -> 401. One code and one body for all three, so an unknown source and an unconfigured one
     are indistinguishable (fable C2, m67410).
  3. IP rule, only if `SIGNAL_INGEST_ALLOWED_IP_AXIOM` (per source) is set: x-forwarded-for first hop must
     match (agent-api's rule) -> else 403. Unset for axiom (R7 m67429: Q7 could not be checked, so treat
     Ubuntu-Axiom as having no static IP). The step stays in the code for a later source.
  4. Token: `Authorization: Bearer <token>`, token >= 32 chars, sha256 compared with timingSafeEqual against
     the step-2 env var -> else 401.
  5. Only now `req.text()`. Body checks, any failure -> 400 for the whole batch, nothing written:
     content-type application/json, cap 64 KB, valid JSON, strict (unknown fields refused), 1 to 200 calls,
     each field's type/format, body `source` != path source, and each call's symbol not in
     src/lib/signal-instruments.ts (fable P5(b) m67410; whole batch per G4 m67417, the 400 body names the
     index and the symbol: a symbol with no unit size and dead-band can never be scored, and the regex alone
     lets a leaked token fill the table with junk symbols), a neutral call with entryPx or exitPx (section
     3), a meta.source outside {card, backfill} (fable R8 m67446, kept m67483), an exitPx with no entryPx in the same post or on the stored row (N6, ACCEPTED m67474), entryPx
     without entryBarTs or entryBarTs without entryPx, exitPx without exitBarTs or exitBarTs without exitPx,
     and a bar ts outside [entry_ts, exit_ts) (Q9 mechanics, m67474).
- Body (S1): `{ "source": "axiom", "calls": [ { symbol, sessionDate, direction, entryPx?, entryBarTs?, exitPx?,
  exitBarTs?, meta? } ] }` 1 to 200 calls per POST, so the history backfill is a loop of POSTs.
  - symbol = Axiom's "pair" (XAUUSD, US30, EURUSD, GBPUSD, USDJPY, AUDUSD), not the Yahoo ticker.
    sessionDate = Axiom's "date" (R2 m67429). direction = up | down | neutral (R1).
  - entryPx = OPEN of the 06:00Z hourly bar (fallback 07:00Z, then 08:00Z); exitPx = CLOSE of the 20:00Z bar
    (fallback 19:00Z, then 18:00Z) (axiom via marcus m67465). entryBarTs / exitBarTs = the START of the bar
    actually used, ISO-8601 UTC; stored in entry_bar_ts / exit_bar_ts (section 3). entryPx is optional at
    registration and fill-once; the sender is told to send it with the registration post.
  - No entryTs / exitTs (N3, ACCEPTED m67474): the portal derives the window from sessionDate and a
    per-source window in code (`{ axiom: [6, 21] }` UTC hours, beside the token map). entryTs / exitTs are
    unknown fields, so the strict parser refuses them (400). A later source with another window is a code
    entry, as adding a source already is (C2).
  - No move / outcome (R4 m67429; N2 CONFIRMED m67474). The strict parser refuses them as unknown fields (400).
  - meta.source (fable R8 m67446, kept m67483; amends m67429's "verbatim"): enum {card, backfill},
    FILL-ONLY at registration like the rest of meta (G2). Axiom's file string "backfill: read from
    market_card_<date>.jpg" is sent as "backfill"; the poster maps it. Name clash, flagged: this is not the
    `source` column ('axiom'). It stays in meta (N5 KEEP IN META, m67474); see section 5 for the one place it
    is read.
- Per call, one upsert on (source, symbol, entry_ts), all calls in one transaction. A field the post omits
  is not a change. Order per call: the 409 checks, then scoring.
  - 409, WHOLE BATCH rolled back (bugs; stopping is right, m67410), the same three families as the trigger:
    a NEVER column sent and different from the stored row (direction; symbol and session_date give the key,
    the window is derived, source is the path); a FILL-ONLY column (entry_px P1, meta G2) stored non-null
    and sent different; a scored row whose sent exitPx differs (a rescoring is a correction, and corrections
    go to marcus as SQL). Fable m67446, kept m67483: "entryPx or exitPx differing from a stored non-null
    value -> 409".
  - Prices are compared on the SCALED INTEGER (fable A1 m67483): a sent price is Math.round(px * 1e6) and the
    stored one is stored_px * 1e6; "unchanged" and 409 compare those two integers, never the sent float with
    the stored decimal. Else a repost that carries a 7th decimal of the same price 409s against the stored
    6-dp value and the retry is no longer safe.
  - new key: insert, `received_at` = now(); with entryPx, also entry_bar_ts and `entry_px_at` = now(); if
    entry_px and exit_px are both known, score it, exit_bar_ts, and `scored_at` = now().
  - same key, nothing new: no write ("unchanged").
  - same key, fills a null entry_px (with entry_bar_ts and `entry_px_at` = now(), one statement) or meta, or
    brings exitPx to an unscored row: update, scoring, exit_bar_ts and `scored_at` = now() when both prices
    are then known.
  - The 409 families include the new columns: entry_bar_ts with entry_px (FILL-ONLY), exit_bar_ts with exitPx
    on a scored row (FROZEN-ONCE-SCORED). entry_px_at is never sent, so it never causes a 409.
- Scoring (R4 m67429): the portal is the scorer of record and the only one. It computes move and outcome
  from entry_px, exit_px, direction and src/lib/signal-instruments.ts. Coxwell's scoreboard rule (m67335 as
  quoted in m67349 and m67429; I have not read m67335 itself): under 5 pips FX, under $2 XAUUSD, under 20
  pts US30 = FLAT. Axiom's own scorer is sign-only with no dead-band (:108), so the portal's numbers will
  differ from track_record's (marcus m67429 quotes 16/33). Expected; the page's method note says so in one
  line (section 5).
  - move definition (mine, stands per fable m67474): direction-relative, in the symbol's units, + = in the
    call's favour. FLAT when |move| < dead-band (strict, "under"); else right if move > 0, wrong if move < 0.
  - Arithmetic (N4 AMENDED, fable m67474), integers only, the move is never rounded:
    pi = Math.round(px * 1e6) for entry and exit (exact for any quote with <= 6 decimals); ui = unit * 1e6
    (100 for 0.0001, 10000 for 0.01, 1000000 for 1.0); d = exit_i - entry_i, sign flipped for down;
    flat = |d| < band * ui, compared as integers; move = d / ui, stored (exact decimal, 2 dp for FX; 5 for an
    exact 5-pip move). entry_px and exit_px are stored as pi / 1e6, 6 dp (my A1, ACCEPTED fable m67483: 6 dp
    loses nothing Yahoo sends); a price with more decimals is rounded at receipt.
    Why (fable, RUN on her side, not by me): (1.0855 - 1.0850) / 0.0001 = 4.999999999999449 in a double, so
    an exact 5-pip EURUSD move would score FLAT by accident (1.0850 - 1.0845 the same); USDJPY 150.05 -
    150.00 lands at 5.000000000001137, the other side. Rounding the move instead would turn a true 4.96-pip
    move (Yahoo FX quotes carry 5-6 decimals) into 5.0 and rewrite coxwell's "under 5". Range: US30 45000 *
    1e6 = 4.5e10 < 2^53.
  - RETIRED by R4 (N2 CONFIRMED, fable m67474; text kept from S0.3 per m67483): the outcome cross-check, the
    per-call skip, `mismatched[]`, sent/computed, G3's mismatched new-row shape and the fill-and-score variant
    (m67410, m67417). Her m67416 G3 text and the 422 paragraph of m67410 are superseded. With no outcome sent
    there is nothing to disagree with. My m67432 calls 2 (mismatched existing row meta fill) and 3 (camelCase
    sent keys) are MOOT with it (m67446, kept m67483).
- Response 200: `{ inserted, scored, unchanged }`. Each call lands in exactly one ("scored" = an existing row
  given its scored form; call 4 CONFIRMED m67474). 400/401/403/404/409: `{ error }`, plus `index` (and
  `symbol` for an unknown symbol) when one call caused it.
- Retry: any POST is safe to repeat. Same key + same values (prices compared as scaled integers, above) ->
  "unchanged"; entryPx or exitPx differing from a stored non-null value -> 409, whole batch rolled back.
- Consequence of P1, not a new rule (ACCEPTED, m67446 call 7, kept m67483): if the registration post carried
  an entry_px and THAT is wrong, a corrected post changes a set FILL-ONLY column, so it is a 409; only
  marcus's correction SQL fixes that row. docs/signal-ingest.md says so in one line: the poster sends
  entryPx only once it holds the bar.
- docs/signal-ingest.md: created at S0.1 with the two timing values (section 5) as marcus asked (m67424)
  and the two poster rules fable said it must state (send entryPx with the registration post, P1 m67410;
  send meta with the registration post or not at all, G2 m67417). S0.2 adds the fields, the Yahoo series
  per symbol, and "no outcome"; S1 adds the bars, the two bar-ts fields and the rulings (D5 m67474); S1.1 adds
  the meta.source enum, the call 7 line and the 6-dp repost rule (m67483). The rest of the contract (curl line, token generation, the responses above,
  the retry rule) is written into it at S2b, from this section.

### signal-instruments (S2a; R3 + R4 m67429)

| symbol | yahoo_ticker (:33-40) | unit (1 move = ) | band (move units) | band (int at 1e6) | page label |
|---|---|---|---|---|---|
| EURUSD | EURUSD=X | 0.0001 | 5 | 500 | pips |
| GBPUSD | GBPUSD=X | 0.0001 | 5 | 500 | pips |
| AUDUSD | AUDUSD=X | 0.0001 | 5 | 500 | pips |
| USDJPY | JPY=X (quotes USDJPY) | 0.01 | 5 | 50000 | pips |
| XAUUSD | GC=F (gold futures) | 1.0 | 2 | 2000000 | $ |
| US30 | YM=F (Dow futures) | 1.0 | 20 | 20000000 | points |

- Unit sizes and dead-bands are marcus's m67429 values (XAUUSD 2.0 and US30 20.0 "in price units").
- Fields per symbol (fable m67483): yahoo_ticker, unit (non-null), band in units, and the band at 1e6
  WRITTEN OUT as a literal in the file (band * unit * 1e6). The S2a test asserts literal = band * unit * 1e6
  per row, so the two columns cannot drift. No pip_size field: the unit is the pip for FX (m67483).
- XAUUSD and US30 prices are FUTURES prices (GC=F, YM=F), not spot (R3). The Yahoo ticker is a field of
  each row and is printed in docs/signal-ingest.md and the page's method note, so nobody later compares a
  stored price with spot.

## 5. Page: /admin/signals (portal host only, admin only, no nav link)

- Route file src/app/admin/signals/page.tsx. Server component, reads only.
- Gate, three layers, two already on main: proxy.ts:127-132 (no session -> /login, not admin -> 403);
  src/app/admin/layout.tsx:15-16 (redirect unless isAdminUser); plus the page's own isAdminUser check. No
  admin page.tsx on main repeats the check (the actions.ts files and provider-applications/export/route.ts
  do); I add it because this page is meant to be narrower than admin (Q5). Feed host: /admin/signals is not in
  ADMIN_FEED_ROUTES, so portalAdminRedirect (src/lib/feed-host-admin.ts:32) sends it to the portal. Partner host: proxy.ts:53 404s it. No edit to
  proxy.ts or feed-host-admin.ts.
- "coxwell only": isAdminUser is "role admin, or the fallback email". If any account other than coxwell's
  holds admin, the page needs an email allowlist on top (Q5).
- No sidebar link in v1: coxwell opens it by URL. A link would be a one-line append to PORTAL_ADMIN_LINKS
  (src/components/portal/sidebar.tsx:79), a shared file, so only on marcus's word (Q8).
- Query string: `?source=axiom&from=YYYY-MM-DD&to=YYYY-MM-DD` (default: source axiom, all dates).
- Sections:
  1. Headline: calls / right / wrong / flat / neutral / pending / unscored after close / unpriced / hit %, with the
     first and last session_date, and the lead-time buckets below (in place of 8909f17's binary "registered
     before the window opened", fable P4 m67410: a card posted at 06:00:30 is an honest pre-market call that
     fails received_at < entry_ts, so a sender doing the right thing would read 0 of M).
     Split (R8 m67429, "the honest headline"; mechanics fable N5 m67474; layout my A3, ACCEPTED fable m67483):
     the headline is FOUR rows, one per lead-time bucket (before open / within 15 min after open / later in
     window / after close), each carrying the headline numbers, with the sender-label counts card / backfill /
     none beside each row. Two subtotals under them: live = rows 1-3 (received_at < exit_ts), backfilled = row
     4 (received_at >= exit_ts), so live vs backfilled still reads in one glance. The bucket is the portal's
     clock on a shared column, so C2 holds inside signal-stats. The labels come from the page's one read query
     (src/lib/signal-calls.ts) projecting `meta->>'source'` as `sender_label`: the only place a source-specific
     key is read, and no number is keyed on it. A "card" row received after close shows in the after-close
     row with its label; nothing is reconciled.
     Counts beside the headline, each its own number:
     - neutral: counted by direction first, and in none of pending / unscored after close / unpriced (fable
       m67483 carve-out to A2).
     - pending / unscored after close / unpriced: a PARTITION of the up/down rows with outcome null (my A2,
       ACCEPTED fable m67483). exit_ts + 2 h >= now -> pending; else P3 holds -> unscored after close; else ->
       unpriced. P3 (fable m67446 as restated m67474, kept m67483) = direction up/down AND received_at <
       exit_ts AND outcome null AND exit_ts + 2 h < now. So "unpriced" is a backfilled up/down row past the
       grace; a backfilled row posted for a session that closed more than 2 h ago is unpriced from its first
       minute (m67483: "which is right").
     - P3 and the "after close" lead-time bucket key on the SAME comparison, received_at vs exit_ts (m67446
       call 5, kept m67483): P3's received_at < exit_ts is exactly "not after close", and the live /
       backfilled subtotals use it too.
     - entry priced after close (fable D1 m67474), muted: a live row with entry_px_at >= exit_ts. A separate
       count over live rows, scored or not, orthogonal to the partition above (m67483).
     Residual, accepted (m67474): a LIVE call Axiom cannot price after its three fallbacks shows as unscored
     after close, the same as an abandoned one; rare, marcus can look. Backlog N7: an explicit no-price post at
     close, if it ever happens.
  2. Per-pair table: calls, hit %, net move in the pair's unit if every call was followed, avg move when
     right, avg move when wrong, up hit % (n), down hit % (n), neutral count (R1), unscored after close.
     Under 10 scored calls: an "n<10" tag on the row and its percentages muted.
  3. Cumulative hit rate over time (one line, all pairs), and cumulative net move PER PAIR (one line per pair).
     Not one summed line: 5 FX pips and 20 US30 points are different units, so a sum across pairs is not a
     number. (If coxwell wants one line, the honest one is move / dead-band per call; a decision for marcus.)
  4. Per-pair chart with each call marked: see S5.
- Hit % = right / (right + wrong); flats and neutrals are counted and shown, not in the denominator.
  track_record.py's is hits / scored up+down calls with neutrals out (:118-124) and no flat class, so the
  formulas agree and only the dead-band separates the two numbers (R4). Method note, one line: "Scored with
  a dead-band (5 pips FX, $2 gold, 20 points US30 = flat); Axiom's own track record has none, so its hit %
  differs." Wording is mine; marcus or fable may replace it.
- Two named constants in src/lib/signal-stats.ts (fable G5 m67417; values marcus m67424, "I accept fable's
  proposal as-is"), each named with its meaning in docs/signal-ingest.md and in the page's method note:
  - `UNSCORED_AFTER_CLOSE_GRACE_MS` = 2 h. A live (received_at < exit_ts) up/down call with outcome null is
    "unscored after close" when exit_ts + 2 h < now, else "pending" (fable P3 m67410, the live condition
    m67446/m67474). Without it a sender could register calls and never score the losers; pending-forever is
    the one hindsight hole C3 opens, so it is shown, not pooled. Neutral calls are in neither bucket (R1
    m67429: must not count as abandoned; section 3); a backfilled up/down row past the grace is "unpriced"
    (the A2 partition above, m67483).
  - `LEAD_WITHIN_WINDOW_MS` = 15 min. Lead-time bucket per call, from received_at against the window (fable
    P4 m67410: before open / within 15 min after open / later in window / after close):
    before open = received_at < entry_ts; within 15 min = entry_ts <= received_at < entry_ts + 15 min;
    later in window = entry_ts + 15 min <= received_at < exit_ts; after close = received_at >= exit_ts
    (every backfilled row). The half-open edges are mine (call 5, CONFIRMED m67474).
    Axiom's card goes out ~06:10Z (axiom m67428 via marcus m67429), 10 min after entry_ts, so a live call
    lands in "within 15 min after open" at best. The page states that, it does not hide it: those 10 min of
    price are known when the call is made.
  - Window labels: fixed UTC all year, "06:00-21:00 UTC" (Q3 answered, :41 :77). No BST handling.
  - Constant names are mine; the values are marcus's.
- Charts: NO chart library is in package.json at 544f6fc (dependencies: next, react, next-auth, neon,
  upstash, blob, resend, lucide-react, flag-icons). No new dependency: the charts follow
  src/components/feed/method-charts.tsx (server-rendered; lines as SVG paths in a stretched box with
  non-scaling strokes; labels and markers as positioned HTML; a "Show the numbers" table under each chart).
  No client JS. I read the dataviz skill before the first line of chart code (S4).

## 6. Code layout (all new files; no existing file edited in v1)

| File | Slice |
|---|---|
| db/migrations/0110_signal_calls.sql, 0110_rollback.sql | S1 |
| src/lib/signal-calls-0110.test.ts | S1 |
| src/lib/signal-instruments.ts (yahoo_ticker, unit, band in units and at 1e6, unit label per symbol) | S2 |
| src/lib/signal-ingest.ts, signal-ingest.test.ts | S2 |
| src/app/api/signals/ingest/[source]/route.ts | S2 |
| docs/signal-ingest.md | S0.1 (timing values, poster rules), S0.2 (fields, Yahoo series, no outcome), S1 (bars, bar-ts fields), S1.1 (meta.source enum, call 7, 6-dp repost), S2b (the rest) |
| src/lib/signal-stats.ts (pure), signal-stats.test.ts | S3 |
| src/lib/signal-calls.ts (the page's one read query) | S4 |
| src/app/admin/signals/page.tsx, signals.css | S4 |
| src/components/admin/signal-charts.tsx | S4, S5 |

## 7. Tests (node:test, the repo's runner line `npx tsx --test <file>`)

- S1 signal-calls-0110.test.ts, pglite, the consult-0105.test.ts shape (applies every migration in order,
  0110 included): good rows in (bare registration, entry-filled, scored per outcome, neutral); each CHECK
  refuses its bad row, built so it breaks exactly that one constraint (direction 'buy', source and symbol
  format, outcome 'hit', window, each arm of signal_calls_entry_stamp, each arm of signal_calls_scored_stamp
  with exit_bar_ts, a neutral row with an entry price, a neutral row with the scored form; the stamps force
  "neutral with exit_px" and "neutral with an outcome" into the scored-form row); the unique key refuses a
  second call for the same window; the rollback refuses while rows exist, then drops the table, the function
  and its ledger row.
  Scope (fable m67446 call 6, kept m67483): S1 tests the three trigger families, the correction GUC, and the
  CHECKs she names (direction enum, the stamps, the neutral CHECK, now signal_calls_neutral_unscored); the
  rest of this list is on top of hers, not instead of it.
  Trigger (fable P2 m67410, D2/D3 m67474): each NEVER column refused; the fill statement (entry_px +
  entry_px_at + entry_bar_ts, one statement) passes; meta null -> value passes; each FILL-ONLY column (entry_px,
  entry_px_at, entry_bar_ts, meta) value -> other value refused, with and without an outcome; each
  FROZEN-ONCE-SCORED column (exit_px, exit_bar_ts, move, outcome, scored_at) refused once scored; the
  register-then-score update passes; `set local signal_calls.allow_correction = 'on'` passes for each family
  and 'off' does not; DELETE passes.
- S2 signal-ingest.test.ts, gate cases one per step of the section 4 list, in its order: non-production 404;
  path source bad format 401, not in the map 401, env unset 401, env malformed 401 (one body for all four);
  IP rule set and wrong 403; short token 401, wrong token 401, axiom token on the sentiment path 401; the body
  is not read before step 5 passes; source assertion that the compare is timingSafeEqual, as
  agent-api.test.ts:227. Body 400s: unknown field, 0 and 201 calls, 64 KB + 1, bad date, bad direction, body
  source != path source, unknown symbol (whole batch, nothing written, index + symbol in the body), a
  `move` or `outcome` field, an `entryTs` or `exitTs` field, a neutral call with entryPx, meta.source
  'card-ish' (not in the enum), exitPx with no
  entryPx sent or stored, entryPx without entryBarTs and the reverse, exitPx without exitBarTs and the
  reverse, a bar ts before entry_ts and one at exit_ts. Window: entry_ts and exit_ts stored as sessionDate
  06:00Z and 21:00Z. Upsert: register then score; entry_px_at = the fill's now(), not sent; identical repost
  unchanged; a repost carrying a 7th decimal of the same price unchanged, not 409 (fable A1 m67483); a price
  with 7 decimals stored at 6; changed direction 409 and nothing in the batch written (the R5 rewritten day);
  set entry_px changed 409; set entryBarTs changed 409; set meta changed 409; changed exitPx or exitBarTs on
  a scored row 409. Dead-band edges (N4, fable m67474's inputs, RUN on her side): EURUSD 1.0850 -> 1.0855 up
  is 5 pips, NOT flat (a double gives 4.999999999999449); 1.0845 -> 1.0850 the same; USDJPY 150.00 -> 150.05
  is 5 pips, not flat, and move stored as exactly 5 (a double gives 5.000000000001137); EURUSD 1.0835 ->
  1.0840 at the band, by sign (S0.3 line, kept m67483); a true 4.96-pip move stays FLAT (not rounded to 5);
  XAUUSD $2.00 vs $1.99, US30 20 vs 19.9; up and down signs. Each edge test uses float-literal inputs (as
  JSON.parse gives them). signal-instruments: per row, the 1e6 band literal = band * unit * 1e6 (m67483).
  The G3 mismatch cases are dropped with G3 (section 4).
- S3 signal-stats.test.ts: a hand-built fixture of about 14 calls over 3 pairs with every expected number
  written out by hand in the test (headline, per pair, up/down split, avg right/wrong, the n<10 flag at 9
  and 10, cumulative series in date order, flats and neutrals outside the hit % denominator, pending outside
  everything, the four lead-time rows with the card / backfill / none label counts beside each and the live
  (rows 1-3) / backfilled (row 4) subtotals, a "card" row received after close shown in the after-close row).
  Plus: unscored after close at exit_ts + 2 h exactly and 1 ms either side; a backfilled up/down row past the
  grace is unscored-after-close NO and unpriced YES; a backfilled up/down row inside the grace is pending; a
  neutral row past the grace is in neither pending, unscored after close nor unpriced; received_at = exit_ts -
  1 ms is P3-eligible and live, received_at = exit_ts is neither (the shared comparison, call 5, kept m67483);
  entry priced after close at entry_px_at = exit_ts and 1 ms before; each lead-time bucket at both of its
  edges.
- Every test is seen failing against a stub before the code passes (CLAUDE.md rule 7).
- NOT RUNNABLE ON MY BOX: `npx tsx --test` was refused here on 2026-10-13 (consult thread). I will retry it per
  slice. If refused, the run goes to Leo or marcus with the exact line, and I report it as not run by me.
- tsc and lint per slice, separately. Lint baseline on main: I re-read it on 544f6fc before S1.
- The page cannot be rendered from this box (`next build` refused). Render proof = Leo or a Vercel preview.
  A preview's /admin/signals reads the prod table (reads only); its ingest answers 404 by design.

## 8. Slices (each under 2400s, one push each)

| Slice | What | Size (lines, incl. tests) | Gate |
|---|---|---|---|
| S0 | this plan | ~200 | fable review, marcus GO |
| S0.1 | this revision + docs/signal-ingest.md (timing values, poster rules) | doc only | marcus GO m67424 |
| S0.2 | Axiom's answers + R1-R8 (m67429) | doc only | marcus m67435 |
| S1 | 0110 (table + trigger) + rollback + pglite test + doc deltas D4-D8 | ~450 | fable PASS of 5abac28 + S0.2 (marcus m67429/m67435), given m67474 WITH CHANGES; 0110 re-checked before push (m67403) |
| S1.1 | fable m67483: S0.3 KEEP items + A1-A3 | doc only | fable m67483 (marcus's GO unchanged) |
| S2a | signal-instruments + signal-ingest lib + tests | ~400 | S1 |
| S2b | route + docs/signal-ingest.md | ~120 | S2a |
| S3 | signal-stats (pure) + tests | ~300 | S2a |
| S4 | page sections 1-3, charts, css | ~400 | S3; dataviz skill read first |
| S5 | per-pair price-line chart with call markers | ~200 | S4 |

About 1,600 lines. S5 (R6 m67429, no bars): a price line through each call's entry_px and exit_px (two
points a day, no new data), a marker at each entry coloured by outcome with an up/down glyph, so colour is
never the only signal. Neutral calls: a hollow marker on the date with no price point (they have none).
The axis for XAUUSD and US30 is labelled with the futures ticker (GC=F, YM=F).

Rollout (not mine to do; listed so nothing is assumed):
- R1 marcus applies 0110 before the code merges (the ingest and the page both name the table).
- R2 someone with Vercel access sets SIGNAL_INGEST_SHA256_AXIOM (production scope). Only the hash.
  The poster's URL is /api/signals/ingest/axiom.
- R3 the Axiom side builds the poster and the history backfill from docs/signal-ingest.md. Not my box.
- R4 Leo or marcus merges. I never merge.

## 9. Questions for marcus (answers from the files, not from memory)

Status at S0.1: Q1 ANSWERED (marcus m67403: 0110 is mine; re-check main, every open branch and the bus for
0110 right before pushing S1). Q5 ANSWERED (m67403, marcus's own read-only prod read: one admin-role row, so
isAdminUser alone in v1, no allowlist). Q8 ANSWERED (m67403: no sidebar link in v1). Q4 asked of Axiom by
marcus (m67425) and gates S1; Q2/Q3/Q6/Q7 asked in the same message.

Status at S0.2 (axiom m67428 via marcus m67429): Q2 ANSWERED as relayed text with axiom's line numbers
(fields, symbols, scorer, hit %; no pip sizes in Axiom's files, so the sizes are marcus's R4), not as a
paste; Q3 ANSWERED fixed UTC; Q4 ANSWERED no bars; Q6 ANSWERED feasible, not built, outbound unverified;
Q7 could not be checked, treated as no static IP. New: Q9.

Status at S1: Q9 ANSWERED (axiom via marcus m67465, track_record.py :84-87, not read by me; mechanics fable
m67474: bar-ts columns, section 3).

- Q1 Confirm migration number 0110.
- Q2 Paste 5 lines of predictions.jsonl and track_record.py's scoring code: field names, the symbol list,
  the pip/point size per symbol (is an XAUUSD "point" $1 or $0.01?), whether "under 5 pips" is strict, and
  its hit % formula. S2 and S3 are built against that text, cited by file and line.
- Q3 "06:00 -> 21:00 GMT": fixed UTC all year, or London time across BST? (The table stores absolute
  timestamps either way; this is for the chart labels and the docs.)
- Q4 Does Axiom have 4H OHLC bars for its pairs, and from which feed? Yes = signal_bars in 0110 and candles in
  S5. No = price line through the calls' own prices.
- Q5 Does any account other than coxwell's hold the admin role? If yes, the page needs an email allowlist and
  I need coxwell's login email from you.
- Q6 Can Axiom post each call twice (at call time, then scored)? Who builds the poster on Ubuntu-Axiom?
- Q7 Does Ubuntu-Axiom have a static egress IP (for the optional IP rule)?
- Q8 Sidebar link: none in v1 (URL only), unless you want the append.
- Q9 (not a blocker before S2b) Which bar field are track_record's "start" and "end" (:77, :108): 06:00
  bar open and 20:00 bar close, or something else? docs/signal-ingest.md must tell the poster exactly
  which price is entryPx and exitPx, and whether entryPx exists at ~06:10Z when the card posts.

Later, not in this plan: the tester-group view (a role or an email list on the same page lib), and a Horizon
One surface. Both read the same table and the same stats lib; neither needs a schema change.
