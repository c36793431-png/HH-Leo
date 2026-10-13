# Axiom signals dashboard: plan (PLAN ONLY, no code until marcus's named GO per slice)

Job: marcus m67349 (2026-10-13 17:35Z, room axiom-dashboard-2026-10-13), from coxwell 17:3xZ.
Branch: kai/axiom-signals-dashboard-2026-10-13, off main 544f6fc. Reviewer: fable. Author: kai.

Revision S0.1 (doc only, on 8909f17; marcus named GO m67424 18:20Z): folds in fable's review m67410 (18:08Z,
P1-P5 + the 422 ruling) and her answers to my gaps m67417 (18:14Z, G1-G5), and marcus's G5 values (m67424).
Each changed rule below names the message it comes from. S1 is NOT GO: it waits on Q4 (marcus m67424).

Everything below about the repo was read at 544f6fc. Nothing about Ubuntu-Axiom was read: predictions.jsonl
and track_record.py are on a box I cannot reach, so every statement about them is marcus's m67349 text, and
the open questions in section 9 must be answered from the files themselves before S2.

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
  direction text not null check (direction in ('buy', 'sell')),
  entry_ts timestamptz not null,                                    -- window start (06:00 for Axiom)
  exit_ts timestamptz not null,                                     -- window end (21:00 for Axiom)
  entry_px numeric,                                                 -- fill-only; required once scored (stamp)
  exit_px numeric,
  move numeric,          -- signed, in the symbol's unit (pips FX, points XAUUSD/US30), + = in the call's favour
  outcome text check (outcome in ('right', 'wrong', 'flat')),
  meta jsonb,                                                       -- fill-only; source-specific: confidence, card id, ...
  received_at timestamptz not null default now(),                   -- first receipt; never rewritten
  scored_at timestamptz,                                            -- first receipt of the scored form
  updated_at timestamptz not null default now(),
  constraint signal_calls_window check (exit_ts > entry_ts),
  constraint signal_calls_scored_stamp check (
    ((outcome is null) = (exit_px is null)) and ((outcome is null) = (move is null))
    and ((outcome is null) = (scored_at is null)) and (outcome is null or entry_px is not null)
  ),
  constraint signal_calls_one_per_window unique (source, symbol, entry_ts)
);
create index if not exists signal_calls_source_date_idx on signal_calls(source, session_date);
```

Plus the schema_migrations ledger row, begin/commit, and 0110_rollback.sql (drop table, which drops the
trigger with it; the rollback also drops the trigger function) as 0105/0107 do.
The stamp CHECK is conjoined equalities, not `a = b = c` (0107:9 note).

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
  never is, so S0.1 makes meta nullable with no default: a call posted without meta stores null. This is my
  change, made to keep G2's rule literal; fable rules it (the alternative is to treat `'{}'` as unset).

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

Not in 0110: price bars for the 4H chart. See S5 and Q4. If marcus answers Q4 yes before S1, I add
`signal_bars (source, symbol, tf, ts, o, h, l, c, unique (source, symbol, tf, ts))` to 0110 so it is one
apply, not two.

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
     match (agent-api's rule) -> else 403. Default unset: one non-money table, and Ubuntu-Axiom's egress IP is
     unknown to me (Q7).
  4. Token: `Authorization: Bearer <token>`, token >= 32 chars, sha256 compared with timingSafeEqual against
     the step-2 env var -> else 401.
  5. Only now `req.text()`. Body checks, any failure -> 400 for the whole batch, nothing written:
     content-type application/json, cap 64 KB, valid JSON, strict (unknown fields refused), 1 to 200 calls,
     each field's type/format, body `source` != path source, and each call's symbol not in
     src/lib/signal-instruments.ts (fable P5(b) m67410; whole batch per G4 m67417, the 400 body names the
     index and the symbol: a symbol with no unit size and dead-band can never be scored, and the regex alone
     lets a leaked token fill the table with junk symbols).
- Body: `{ "source": "axiom", "calls": [ { symbol, sessionDate, direction, entryTs, exitTs, entryPx?, exitPx?, move?, outcome?, meta? } ] }`
  1 to 200 calls per POST, so the history backfill is a loop of POSTs. Field names wait on Q2.
- Per call, one upsert on (source, symbol, entry_ts), all calls in one transaction. A field the post omits
  is not a change (needed for G3's "the retry does not need to resend meta"). Order per call: the 409 checks,
  then the recompute.
  - 409, WHOLE BATCH rolled back (bugs; stopping is right, m67410), the same three families as the trigger:
    a NEVER column sent and different from the stored row (direction, session_date, exit_ts; symbol and
    entry_ts are the key, source is the path); a FILL-ONLY column (entry_px P1, meta G2) stored non-null and
    sent different; a scored row whose sent scored values differ (a rescoring is a correction, and
    corrections go to marcus as SQL).
  - new key, recompute agrees (or no scored form sent): insert, `received_at` = now(); if scored,
    `scored_at` = now().
  - same key, nothing new: no write ("unchanged").
  - same key, fills a null entry_px or meta, or brings the scored form to an unscored row (recompute agrees):
    update, `scored_at` = now() when scored.
- Outcome cross-check: the portal recomputes move and outcome from entry_px, exit_px, direction and its own
  instrument table (src/lib/signal-instruments.ts: unit size and dead-band per symbol; marcus m67349: under
  5 pips FX, under $2 XAUUSD, under 20 pts US30 = FLAT). The portal is the scorer of record: its move and
  outcome are what is stored; Axiom's sent values go nowhere but the response (fable m67410, replacing the
  8909f17 422).
  - Disagreement = PER-CALL SKIP, the rest of the batch is written (m67410). Why not refuse the batch: one
    dead-band edge would stall a 200-call backfill and every retry. Why not store-and-flag: with C4 in force a
    wrong stored outcome needs SQL corrections across immutable rows; skipping writes nothing wrong.
  - A mismatched NEW key is inserted with source, symbol, entry_ts, exit_ts, session_date, direction,
    received_at and meta as sent; entry_px NULL; scored columns null (G3 m67417). It then shows as pending,
    and after the grace as "unscored after close" (section 5).
  - A mismatched EXISTING key: no entry_px and no scored column is written. Whether a null meta on that row
    is filled by the same post is NOT ruled (my reading of "no partial write" is: nothing written); fable.
- Response 200: `{ inserted, scored, unchanged, mismatched: [ { index, sent: { entryPx, exitPx, move, outcome }, computed: { move, outcome } } ] }`
  (G3 detail 1 m67417, so marcus can see which input was wrong; fable wrote the sent keys in the column
  case, I use the body's case). Each call lands in exactly one of inserted / scored / unchanged /
  mismatched (my definition, not ruled). 400/401/403/404/409: `{ error }`, plus `index` (and `symbol` for
  an unknown symbol) when one call caused it.
- Retry (G3 detail 2 m67417): any POST is safe to repeat. Calls already written answer "unchanged". A
  corrected retry of a mismatched call hits the idempotent path as fill-and-score, not 409: same key,
  entry_px null -> fill, recompute, write. A retry that still mismatches leaves the row unscored again, no
  partial write.
- Consequence of P1, not a new rule: if the registration post carried an entry_px and THAT is the wrong
  input, the corrected retry changes a set FILL-ONLY column, so it is a 409; only marcus's correction SQL
  fixes that row.
- docs/signal-ingest.md: created at S0.1 with the two timing values (section 5) as marcus asked (m67424)
  and the two poster rules fable said it must state (send entryPx with the registration post, P1 m67410;
  send meta with the registration post or not at all, G2 m67417). The rest of the contract (curl line, token
  generation, fields, the responses above, the retry rule) is written into it at S2b, from this section.

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
  1. Headline: calls / right / wrong / flat / pending / unscored after close / hit %, with the first and
     last session_date, and the lead-time buckets below (in place of 8909f17's binary "registered before
     the window opened", fable P4 m67410: a card posted at 06:00:30 is an honest pre-market call that fails
     received_at < entry_ts, so a sender doing the right thing would read 0 of M).
  2. Per-pair table: calls, hit %, net move in the pair's unit if every call was followed, avg move when
     right, avg move when wrong, buy hit % (n), sell hit % (n), unscored after close. Under 10 scored calls:
     an "n<10" tag on the row and its percentages muted.
  3. Cumulative hit rate over time (one line, all pairs), and cumulative net move PER PAIR (one line per pair).
     Not one summed line: 5 FX pips and 20 US30 points are different units, so a sum across pairs is not a
     number. (If coxwell wants one line, the honest one is move / dead-band per call; a decision for marcus.)
  4. Per-pair chart with each call marked: see S5.
- Hit % = right / (right + wrong); flats are counted and shown, not in the denominator. This must equal
  track_record.py's definition or the page and Axiom's own report disagree in front of coxwell (Q2).
- Two named constants in src/lib/signal-stats.ts (fable G5 m67417; values marcus m67424, "I accept fable's
  proposal as-is"), each named with its meaning in docs/signal-ingest.md and in the page's method note:
  - `UNSCORED_AFTER_CLOSE_GRACE_MS` = 2 h. A call with outcome null is "unscored after close" when
    exit_ts + 2 h < now, else "pending" (fable P3 m67410). Without it a sender could register calls and never
    score the losers; pending-forever is the one hindsight hole C3 opens, so it is shown, not pooled.
  - `LEAD_WITHIN_WINDOW_MS` = 15 min. Lead-time bucket per call, from received_at against the window (fable
    P4 m67410: before open / within 15 min after open / later in window / after close):
    before open = received_at < entry_ts; within 15 min = entry_ts <= received_at < entry_ts + 15 min;
    later in window = entry_ts + 15 min <= received_at < exit_ts; after close = received_at >= exit_ts
    (every backfilled row). The half-open edges are my choice, not ruled.
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
| src/lib/signal-instruments.ts (unit size, dead-band, unit label per symbol) | S2 |
| src/lib/signal-ingest.ts, signal-ingest.test.ts | S2 |
| src/app/api/signals/ingest/[source]/route.ts | S2 |
| docs/signal-ingest.md | S0.1 (timing values, poster rules), S2b (the rest) |
| src/lib/signal-stats.ts (pure), signal-stats.test.ts | S3 |
| src/lib/signal-calls.ts (the page's one read query) | S4 |
| src/app/admin/signals/page.tsx, signals.css | S4 |
| src/components/admin/signal-charts.tsx | S4, S5 |

## 7. Tests (node:test, the repo's runner line `npx tsx --test <file>`)

- S1 signal-calls-0110.test.ts, pglite, the consult-0105.test.ts shape (applies every migration in order,
  then 0110): good row in; each CHECK refuses its bad row (direction, source format, window, each arm of the
  stamp); the unique key refuses a second call for the same window; rollback drops cleanly and its ledger row.
  Trigger (fable P2 m67410): each NEVER column refused; entry_px and meta null -> value passes, value ->
  other value refused, with and without an outcome; each FROZEN-ONCE-SCORED column refused once scored; the
  register-then-score update passes; the `set local signal_calls.allow_correction = 'on'` path passes for
  each family; DELETE passes.
- S2 signal-ingest.test.ts, gate cases one per step of the section 4 list, in its order: non-production 404;
  path source bad format 401, not in the map 401, env unset 401, env malformed 401 (one body for all four);
  IP rule set and wrong 403; short token 401, wrong token 401, axiom token on the sentiment path 401; the body
  is not read before step 5 passes; source assertion that the compare is timingSafeEqual, as
  agent-api.test.ts:227. Body 400s: unknown field, 0 and 201 calls, 64 KB + 1, bad date, bad direction, body
  source != path source, unknown symbol (whole batch, nothing written, index + symbol in the body). Upsert:
  register then score; identical repost unchanged; changed direction 409 and nothing in the batch written;
  set entry_px changed 409; set meta changed 409; rescoring 409. Dead-band edges per class: exactly 5.0 pips
  not FLAT, 4.9 FLAT, a JPY pair's pip, XAUUSD $2.00 vs $1.99, US30 20 vs 19.9. Mismatch (G3 m67417): a
  mismatched new call is inserted with entry_px null and scored columns null while the rest of the batch is
  written, mismatched[] carries sent + computed; the corrected retry scores it; a retry that still
  mismatches leaves it unscored, no partial write. Fable listed the G3 cases under S1; they need the ingest
  code, so they are here, and "shows in unscored after close" is in S3.
- S3 signal-stats.test.ts: a hand-built fixture of about 14 calls over 3 pairs with every expected number
  written out by hand in the test (headline, per pair, buy/sell split, avg right/wrong, the n<10 flag at 9
  and 10, cumulative series in date order, flats outside the hit % denominator, pending outside everything).
  Plus: unscored after close at exit_ts + 2 h exactly and 1 ms either side; each lead-time bucket at both of
  its edges; a mismatched-then-unscored row (G3) lands in unscored after close.
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
| S1 | 0110 (table + trigger) + rollback + pglite test | ~230 | Q1 (number, answered m67403), Q4 (bars in or out) |
| S2a | signal-instruments + signal-ingest lib + tests | ~400 | Q2 (fields, units, scorer rules) |
| S2b | route + docs/signal-ingest.md | ~120 | S2a |
| S3 | signal-stats (pure) + tests | ~300 | Q2 (hit % definition) |
| S4 | page sections 1-3, charts, css | ~400 | S3; dataviz skill read first |
| S5 | per-pair chart with call markers | ~200 (+~250 if bars) | Q4 |

About 1,600 lines without bars. S5 default: a price line through each call's entry_px and exit_px (two
points a day, no new data), a marker at each entry coloured by outcome with a buy/sell glyph, so colour is
never the only signal. Real 4H candles need bars from somewhere (Q4).

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

Later, not in this plan: the tester-group view (a role or an email list on the same page lib), and a Horizon
One surface. Both read the same table and the same stats lib; neither needs a schema change.
