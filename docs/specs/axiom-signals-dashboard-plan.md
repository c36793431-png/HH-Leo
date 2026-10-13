# Axiom signals dashboard: plan (PLAN ONLY, no code until marcus's named GO per slice)

Job: marcus m67349 (2026-10-13 17:35Z, room axiom-dashboard-2026-10-13), from coxwell 17:3xZ.
Branch: kai/axiom-signals-dashboard-2026-10-13, off main 544f6fc. Reviewer: fable. Author: kai.

Revision S0.1 (doc only, on 8909f17; marcus named GO m67424 18:20Z): folds in fable's review m67410 (18:08Z,
P1-P5 + the 422 ruling) and her answers to my gaps m67417 (18:14Z, G1-G5), and marcus's G5 values (m67424).
Each changed rule below names the message it comes from.

Revision S0.2 (doc only, on 5abac28; marcus m67435 18:24Z): folds in Axiom's answers and marcus's product
rulings R1-R8 (m67429 18:22Z). Fable reads 5abac28 + S0.2 as one doc (m67435). S1 GO attaches to fable's
PASS of this doc (m67429, m67435); Q4 is answered (no 4H bars), so nothing else holds S1.

Revision S0.3 (doc only, on 7eb9a73): folds in fable's m67446 (2026-10-13 ~18:29Z, room axiom-dashboard),
her mechanics for R1-R8 and her rulings on my m67432 calls 1-7. m67446 was written before she had my S0.2
sha (m67447 18:29:56Z) and asks for "S0.2 on 5abac28 with R1-R8 + the above folded"; 7eb9a73 already held
R1-R8, so m67446 lands here as S0.3 on top instead of a rewrite of a pushed commit. Fable reads
8909f17..S0.3 as one diff. Where m67446 differs from my S0.2 proposals N1/N3/N4/N5, m67446 wins and the
S0.2 text is replaced, not kept beside it.

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
- NOT KNOWN to me: which bar field "start" and "end" are (06:00 bar open? 20:00 bar close?). The relay
  gives :77 and :108 but not the expression. S2 does not depend on it (the portal takes the prices Axiom
  sends), but docs/signal-ingest.md must name WHICH bar and WHICH field for start and end, or nobody can
  reproduce a stored price (fable R3 m67446). Marked TBC there until Axiom answers (Q9, asked of marcus in
  m67449); not a blocker for S0.3 or S1.

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
  exit_px numeric,
  move numeric,          -- exit_px - entry_px, in PRICE units, signed by the market not the call (m67446)
  outcome text check (outcome in ('hit', 'miss', 'flat', 'neutral')),   -- fable R1 m67446
  meta jsonb,                                                       -- fill-only; source-specific: confidence, card id, ...
  received_at timestamptz not null default now(),                   -- first receipt; never rewritten
  scored_at timestamptz,                                            -- first receipt of the scored form
  updated_at timestamptz not null default now(),
  constraint signal_calls_window check (exit_ts > entry_ts),
  constraint signal_calls_scored_stamp check (
    ((outcome is null) = (exit_px is null)) and ((outcome is null) = (move is null))
    and ((outcome is null) = (scored_at is null)) and (outcome is null or entry_px is not null)
  ),
  constraint signal_calls_neutral_pairing check (
    outcome is null or ((direction = 'neutral') = (outcome = 'neutral'))
  ),
  constraint signal_calls_one_per_window unique (source, symbol, entry_ts)
);
create index if not exists signal_calls_source_date_idx on signal_calls(source, session_date);
```

Plus the schema_migrations ledger row, begin/commit, and 0110_rollback.sql (drop table, which drops the
trigger with it; the rollback also drops the trigger function) as 0105/0107 do.
The stamp CHECK is conjoined equalities, not `a = b = c` (0107:9 note).

Neutral calls (R1 m67429: registered, shown, excluded from hit %; mechanics fable R1 m67446, which replaces
my S0.2 proposal N1 "a neutral row is never scored"):
- A neutral row is SCORED at close like any other: entry_px, exit_px and move are real, outcome = 'neutral'.
  Nothing is skipped; the record shows what the market did on a neutral day.
- The stamp CHECK is UNCHANGED (exit_px, move, outcome, scored_at all null or all not null; entry_px not null
  once scored), so a neutral row needs both prices to be scored, the same as up/down.
- signal_calls_neutral_pairing: once outcome is set, direction 'neutral' <=> outcome 'neutral'. So an up/down
  row can never be stamped 'neutral' and a neutral row can never be stamped hit/miss/flat.
- The ingest takes entryPx/exitPx on a neutral call the same as on up/down (S0.2's 400 for a priced neutral
  is gone).
- Neutral rows are in no hit % denominator and never in "unscored after close" (P3, section 5); an unscored
  neutral past the grace is in the "unpriced" count. It does get a lead-time bucket.
- N1 (backlog, no schema, fable m67446): "neutral calls where the market stayed inside the band" is
  derivable later from move and the symbol's band.

Trigger (fable P2 m67410, G1/G2 m67417): one plpgsql function + BEFORE UPDATE trigger on signal_calls, in
0110. It raises on any UPDATE that breaks one of three column families:

| Family | Columns | Rule |
|---|---|---|
| NEVER | source, symbol, entry_ts, exit_ts, session_date, direction, received_at | never changes |
| FILL-ONLY | entry_px, meta | may go null -> value; once old value is not null it never changes (regardless of outcome) |
| FROZEN-ONCE-SCORED | exit_px, move, outcome, scored_at | never changes once old.outcome is not null |

- All three families bypass only when `current_setting('signal_calls.allow_correction', true) = 'on'`, so a
  correction SQL file from marcus does `set local signal_calls.allow_correction = 'on'` inside its
  transaction; no trigger disable. DELETE is not blocked (rollback and corrections).
- updated_at is in no family.
- The ingest's own register-then-score update (null -> value on entry_px and the scored columns, in one
  statement) passes the trigger by construction.
- pglite runs plpgsql: VERIFIED by fable (m67417: PGlite 0.4.6, Node 20, refuse + `set local` bypass both
  worked). NOT run by me.
- meta was `not null default '{}'` at 8909f17. FILL-ONLY means "set when null" (G2), which a not-null column
  never is, so S0.1 makes meta nullable with no default: a call posted without meta stores null. ACCEPTED
  by fable (m67446 call 1: "'{}' as unset is a second rule nobody remembers").

Choices for fable:
- C1 Unique key (source, symbol, entry_ts), not (source, symbol, session_date): the same table then takes
  an intraday or weekly source (COT is weekly) without a migration. Axiom's daily card is one window a day
  per symbol, so for Axiom the two keys are the same thing.
- C2 Multi-source: `source` is a format CHECK in SQL and an allowlist in code (ingest, section 4). Adding a
  source = a reviewed commit plus one env var, no migration. Anything a source has that the shared columns do
  not (sentiment score, confidence, COT net position) goes in `meta`; the page computes only from shared
  columns (it shows meta.source as a label beside the headline, no number keyed on it: R8 m67446).
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
     lets a leaked token fill the table with junk symbols), an entryTs or exitTs that is sent and differs
     from the derived window (R2 m67446), a meta.source outside {card, backfill} (R8 m67446), an exitPx with
     no entryPx in the same post or on the stored row (my S0.2 N6; m67446 does not rule it).
- Body (S0.3): `{ "source": "axiom", "calls": [ { symbol, sessionDate, direction, entryPx?, exitPx?, entryTs?, exitTs?, meta? } ] }`
  1 to 200 calls per POST, so the history backfill is a loop of POSTs.
  - symbol = Axiom's "pair" (XAUUSD, US30, EURUSD, GBPUSD, USDJPY, AUDUSD), not the Yahoo ticker.
    sessionDate = Axiom's "date" (R2 m67429). direction = up | down | neutral (R1).
  - Window (fable R2 m67446, replaces my S0.2 N3 "no entryTs/exitTs field"): a per-source window in code,
    `{ axiom: [6, 21] }` UTC hours beside the token map, not a table CHECK (C1 keeps the table generic for
    intraday/weekly sources). The ingest DERIVES entry_ts/exit_ts from sessionDate and that window. entryTs
    and exitTs are optional; if sent, each must equal the derived value, else 400. Reason (m67446): the sender
    must never choose exit_ts per call; that is the pre-registration hole R2 closes.
  - No move / outcome (R4 m67429, CONFIRMED and tightened by fable m67446): the strict parser refuses both
    as unknown fields (400), so there is no way to send them. The portal is the sole scorer.
  - meta.source (fable R8 m67446, amends m67429's "verbatim"): enum {card, backfill}, FILL-ONLY at
    registration like the rest of meta (G2). Axiom's file string "backfill: read from market_card_<date>.jpg"
    is sent as "backfill"; the poster maps it. Name clash, flagged: this is not the `source` column ('axiom').
- Per call, one upsert on (source, symbol, entry_ts), all calls in one transaction. A field the post omits
  is not a change. Order per call: the 409 checks, then scoring.
  - 409, WHOLE BATCH rolled back (bugs; stopping is right, m67410), the same three families as the trigger:
    a NEVER column sent and different from the stored row (direction; symbol and session_date give the key,
    the window is derived, source is the path); a FILL-ONLY column (entry_px P1, meta G2) stored non-null
    and sent different; a scored row whose sent exitPx differs (a rescoring is a correction, and corrections
    go to marcus as SQL). Fable m67446: "entryPx or exitPx differing from a stored non-null value -> 409".
  - new key: insert, `received_at` = now(); if entry_px and exit_px are both known, score it and
    `scored_at` = now().
  - same key, nothing new: no write ("unchanged").
  - same key, fills a null entry_px or meta, or brings exitPx to an unscored row: update, scoring and
    `scored_at` = now() when both prices are then known.
- Scoring (R4 m67429): the portal is the scorer of record and the only one. It computes move and outcome
  from entry_px, exit_px, direction and src/lib/signal-instruments.ts. Coxwell's scoreboard rule (m67335 as
  quoted in m67349 and m67429; I have not read m67335 itself): under 5 pips FX, under $2 XAUUSD, under 20
  pts US30 = FLAT. Axiom's own scorer is sign-only with no dead-band (:108), so the portal's numbers will
  differ from track_record's (marcus m67429 quotes 16/33). Expected; the page's method note says so in one
  line (section 5).
  - Scoring rule, as fable m67446 states it "so S2 tests map 1:1":
    move = exit_px - entry_px, in price units. band per symbol, in price units (signal-instruments table
    below): EURUSD/GBPUSD/AUDUSD 0.0005, USDJPY 0.05, XAUUSD 2.0, US30 20.0.
    direction neutral -> outcome 'neutral', whatever the move. Else |move| < band -> 'flat' (strict: a move
    exactly at the band scores by sign, which is coxwell's "<5 pips = flat"); else move's sign agrees with
    direction (up: move > 0, down: move < 0) -> 'hit', disagrees -> 'miss'.
  - Arithmetic (fable m67446, replaces my S0.2 N4 "round move to 0.1 unit"): compare as integers at a fixed
    scale of 1e6, or as SQL numeric; NEVER JS float subtraction (1.0835 - 1.083 in doubles is not 0.0005, so
    the strict '<' flips at the band edge). My pick, for fable to confirm: integers at 1e6 in
    src/lib/signal-ingest.ts (pure, so S2a tests it without a database). Each price is turned into an integer
    once, on receipt (Math.round(px * 1e6)); entry_px and exit_px are stored as that integer / 1e6 (6 dp), and
    move as (exitInt - entryInt) / 1e6, so a stored move always equals stored exit_px - stored entry_px in
    numeric. Consequence: a price with more than 6 decimals is rounded at 6 dp before it is stored. The bands
    are integers at the same scale (0.0005 = 500, 0.05 = 50000, 2.0 = 2000000, 20.0 = 20000000), so the band
    compare is integer-only. Range: US30 ~45000 x 1e6 = 4.5e10, far under 2^53. NOT RUN on this box.
  - RETIRED by R4, CONFIRMED by fable m67446 (her m67416 G3 text and the 422 paragraph of m67410 are
    superseded): the outcome cross-check, the per-call skip, `mismatched[]`, sent/computed, G3's mismatched
    new-row shape and the fill-and-score variant. My m67432 calls 2 (mismatched existing row meta fill) and 3
    (camelCase sent keys) are MOOT with it (m67446).
- Response 200: `{ inserted, scored, unchanged }`. Each call lands in exactly one (ACCEPTED, m67446 call 4;
  "scored" = an existing row given its scored form). 400/401/403/404/409: `{ error }`, plus `index` (and
  `symbol` for an unknown symbol) when one call caused it.
- Retry (m67446): same key + same values -> "unchanged"; entryPx or exitPx differing from a stored non-null
  value -> 409, whole batch rolled back.
- Consequence of P1, not a new rule (ACCEPTED, m67446 call 7): if the registration post carried an entry_px
  and THAT is wrong, a corrected post changes a set FILL-ONLY column, so it is a 409; only marcus's
  correction SQL fixes that row. docs/signal-ingest.md says so in one line: the poster sends entryPx only
  once it holds the bar.
- docs/signal-ingest.md: created at S0.1 with the two timing values (section 5) as marcus asked (m67424)
  and the two poster rules fable said it must state (send entryPx with the registration post, P1 m67410;
  send meta with the registration post or not at all, G2 m67417). S0.2 adds the fields, the Yahoo series
  per symbol, and "no outcome". S0.3 adds the optional entryTs/exitTs rule, the meta.source enum, the
  "send entryPx once you hold the bar" line, and the bar/field question marked TBC. The rest of the contract (curl line, token generation, the responses above,
  the retry rule) is written into it at S2b, from this section.

### signal-instruments (S2a; R3 + R4 m67429)

| symbol | yahoo_ticker (:33-40) | pip_size | band (price units) | band (int at 1e6) | page label |
|---|---|---|---|---|---|
| EURUSD | EURUSD=X | 0.0001 | 0.0005 | 500 | pips |
| GBPUSD | GBPUSD=X | 0.0001 | 0.0005 | 500 | pips |
| AUDUSD | AUDUSD=X | 0.0001 | 0.0005 | 500 | pips |
| USDJPY | JPY=X (quotes USDJPY) | 0.01 | 0.05 | 50000 | pips |
| XAUUSD | GC=F (gold futures) | null | 2.0 | 2000000 | $ |
| US30 | YM=F (Dow futures) | null | 20.0 | 20000000 | points |

- Fields per symbol (fable R4 m67446): yahoo_ticker, pip_size (null for XAUUSD and US30), band in price
  units, and the derived bands WRITTEN OUT as literals in the file, not computed at read time. A file
  (src/lib/signal-instruments.ts), not a table, as the plan has had it since 8909f17.
- pip_size is display only (the page shows FX moves in pips); scoring never divides by it.
- Bands are marcus's m67429 values (5 pips FX, XAUUSD 2.0 and US30 20.0 "in price units"), written in
  price units per m67446.
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
  1. Headline: calls / hit / miss / flat / neutral / pending / unscored after close / unpriced / hit %, with
     the first and last session_date, and the lead-time buckets below (in place of 8909f17's binary
     "registered before the window opened", fable P4 m67410: a card posted at 06:00:30 is an honest
     pre-market call that fails received_at < entry_ts, so a sender doing the right thing would read 0 of M).
     Split (fable R8 m67446, amends m67429's meta.source split and answers my S0.2 N5): the HEADLINE split is
     P4's received_at bucket (portal-stamped; the sender cannot choose it), one row per bucket. meta.source
     is shown beside it as the sender's label (counts of card / backfill / none per row). A row labelled
     card but received after close is shown as such, not rejected and not reconciled. The page reads
     meta.source as a label only; no number is keyed on it.
  2. Per-pair table: calls, hit %, net move in the pair's unit if every call was followed (move signed by
     direction at read time, since stored move is the market's sign), avg move when hit, avg move when miss,
     up hit % (n), down hit % (n), flat count, neutral count (R1), unscored after close, unpriced.
     Under 10 scored calls: an "n<10" tag on the row and its percentages muted.
  3. Cumulative hit rate over time (one line, all pairs), and cumulative net move PER PAIR (one line per pair).
     Not one summed line: 5 FX pips and 20 US30 points are different units, so a sum across pairs is not a
     number. (If coxwell wants one line, the honest one is move / dead-band per call; a decision for marcus.)
  4. Per-pair chart with each call marked: see S5.
- Hit % = hit / (hit + miss) (fable R1 m67446); flat and neutral are per-pair counts, neither in the
  denominator.
  track_record.py's is hits / scored up+down calls with neutrals out (:118-124) and no flat class, so the
  formulas agree and only the dead-band separates the two numbers (R4). Method note, one line: "Scored with
  a dead-band (5 pips FX, $2 gold, 20 points US30 = flat); Axiom's own track record has none, so its hit %
  differs." Wording is mine; marcus or fable may replace it.
- Two named constants in src/lib/signal-stats.ts (fable G5 m67417; values marcus m67424, "I accept fable's
  proposal as-is"), each named with its meaning in docs/signal-ingest.md and in the page's method note:
  - `UNSCORED_AFTER_CLOSE_GRACE_MS` = 2 h. "Unscored after close" (P3, exact predicate fable R1 m67446) =
    direction in ('up','down') AND received_at < exit_ts AND outcome is null AND exit_ts + 2 h < now.
    Without it a sender could register calls and never score the losers; pending-forever is the one
    hindsight hole C3 opens, so it is shown, not pooled. P3 is the one abandonment detector for live
    directional calls.
    Two exclusions, both deliberate (m67446): neutral rows (no hindsight hole in an unpriced neutral) and
    backfilled rows (received_at >= exit_ts; already discounted by the "after close" bucket, and Yahoo's
    range=3mo means old backfill may never get a price). Both show as an "unpriced" count beside the
    neutral / after-close counts, visible but not accusatory.
    Partition of outcome-null rows (my wording of m67446, for fable to confirm): exit_ts + 2 h >= now ->
    "pending"; else P3 holds -> "unscored after close"; else -> "unpriced".
    P3 and the "after close" lead-time bucket key on the SAME comparison, received_at vs exit_ts (m67446
    call 5): P3's received_at < exit_ts is exactly "not after close".
  - `LEAD_WITHIN_WINDOW_MS` = 15 min. Lead-time bucket per call, from received_at against the window (fable
    P4 m67410: before open / within 15 min after open / later in window / after close):
    before open = received_at < entry_ts; within 15 min = entry_ts <= received_at < entry_ts + 15 min;
    later in window = entry_ts + 15 min <= received_at < exit_ts; after close = received_at >= exit_ts
    (every backfilled row). Half-open edges and both constant names ACCEPTED (fable m67446 call 5).
    Axiom's card goes out ~06:10Z (axiom m67428 via marcus m67429), 10 min after entry_ts, so a live call
    lands in "within 15 min after open" at best. The page states that, it does not hide it: those 10 min of
    price are known when the call is made.
  - Window labels: fixed UTC all year, "06:00-21:00 UTC" (Q3 answered, :41 :77). No BST handling.
  - Constant names are mine (accepted m67446); the values are marcus's.
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
| src/lib/signal-instruments.ts (yahoo_ticker, pip_size, band in price units and at 1e6, label per symbol) | S2 |
| src/lib/signal-ingest.ts, signal-ingest.test.ts | S2 |
| src/app/api/signals/ingest/[source]/route.ts | S2 |
| docs/signal-ingest.md | S0.1 (timing values, poster rules), S0.2 (fields, Yahoo series, no outcome), S0.3 (m67446 rules), S2b (the rest) |
| src/lib/signal-stats.ts (pure), signal-stats.test.ts | S3 |
| src/lib/signal-calls.ts (the page's one read query) | S4 |
| src/app/admin/signals/page.tsx, signals.css | S4 |
| src/components/admin/signal-charts.tsx | S4, S5 |

## 7. Tests (node:test, the repo's runner line `npx tsx --test <file>`)

- S1 signal-calls-0110.test.ts, pglite, the consult-0105.test.ts shape (applies every migration in order,
  then 0110). Fable m67446 call 6 (ACCEPTED, with this scope): S1 tests the three trigger families, the
  correction GUC, and the three CHECKs she names (direction enum, stamp, neutral pairing); the rest below is
  on top of her list, not instead of it. Good row in, one per direction, and a scored neutral row (both
  prices, outcome 'neutral') in. Direction CHECK refuses 'buy'. Each arm of the stamp refuses. Neutral
  pairing refuses: neutral + 'hit', neutral + 'flat', up + 'neutral', down + 'neutral'; and passes neutral +
  outcome null. Outcome CHECK refuses 'right'. Source format and window CHECKs refuse their bad rows; the
  unique key refuses a second call for the same window; rollback drops cleanly and its ledger row.
  Trigger (fable P2 m67410): each NEVER column refused; entry_px and meta null -> value passes, value ->
  other value refused, with and without an outcome; each FROZEN-ONCE-SCORED column refused once scored; the
  register-then-score update passes; the `set local signal_calls.allow_correction = 'on'` path passes for
  each family; DELETE passes.
- S2 signal-ingest.test.ts, gate cases one per step of the section 4 list, in its order: non-production 404;
  path source bad format 401, not in the map 401, env unset 401, env malformed 401 (one body for all four);
  IP rule set and wrong 403; short token 401, wrong token 401, axiom token on the sentiment path 401; the body
  is not read before step 5 passes; source assertion that the compare is timingSafeEqual, as
  agent-api.test.ts:227. Body 400s: unknown field, 0 and 201 calls, 64 KB + 1, bad date, bad direction, body
  source != path source, unknown symbol (whole batch, nothing written, index + symbol in the body), a
  `move` or `outcome` field, an entryTs not equal to sessionDate 06:00Z, an exitTs not equal to 21:00Z,
  meta.source 'card-ish' (not in the enum), exitPx with no entryPx sent or stored. Window: entry_ts and
  exit_ts stored as sessionDate 06:00Z and 21:00Z when entryTs/exitTs are omitted, and when sent equal.
  Upsert: register then score; identical repost unchanged; changed direction 409 and nothing in the batch
  written (the R5 rewritten day); set entry_px changed 409; set meta changed 409; changed exitPx on a scored
  row 409. Scoring (fable m67446, one test per line of her rule): neutral -> 'neutral' at a move far past the
  band; EXACTLY AT THE BAND for EURUSD (1.0835 -> 1.0840, move 0.0005, scores by sign, not flat) and for
  USDJPY (move 0.05, by sign); one integer step under the band -> flat for both; XAUUSD 2.0 vs 1.99, US30
  20.0 vs 19.99; up and down, hit and miss each; a price with 7 decimals is stored at 6. Each edge test uses
  float-literal inputs (as JSON.parse gives them), and is seen failing against a float-subtraction stub
  first. The G3 mismatch cases are dropped with G3 (section 4).
- S3 signal-stats.test.ts: a hand-built fixture of about 14 calls over 3 pairs with every expected number
  written out by hand in the test (headline, per pair, up/down split, avg hit/miss move, the n<10 flag at 9
  and 10, cumulative series in date order, flats and neutrals outside the hit % denominator, pending outside
  everything, the headline split by lead-time bucket with the card / backfill / none labels beside it, a
  "card" row received after close shown in the after-close row). Plus: unscored after close at exit_ts + 2 h
  exactly and 1 ms either side; a neutral row past the grace is "unpriced", not unscored after close; a
  backfilled up/down row (received_at >= exit_ts) past the grace is "unpriced"; received_at = exit_ts - 1 ms
  is P3-eligible and received_at = exit_ts is not (the shared comparison); each lead-time bucket at both of
  its edges.
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
| S0.3 | fable's m67446 mechanics + calls 1-7 | doc only | fable m67446 |
| S1 | 0110 (table + trigger) + rollback + pglite test | ~230 | fable PASS of 8909f17..S0.3 as one diff (carries marcus's GO, m67429/m67435/m67446); 0110 re-checked before push (m67403) |
| S2a | signal-instruments + signal-ingest lib + tests | ~400 | S1 |
| S2b | route + docs/signal-ingest.md | ~120 | S2a |
| S3 | signal-stats (pure) + tests | ~300 | S2a |
| S4 | page sections 1-3, charts, css | ~400 | S3; dataviz skill read first |
| S5 | per-pair price-line chart with call markers | ~200 | S4 |

About 1,600 lines. S5 (R6 m67429, no bars): a price line through each call's entry_px and exit_px (two
points a day, no new data), a marker at each entry coloured by outcome with an up/down glyph, so colour is
never the only signal. Neutral calls: a hollow marker at the entry price with no up/down glyph (they are
priced and scored 'neutral', m67446).
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
