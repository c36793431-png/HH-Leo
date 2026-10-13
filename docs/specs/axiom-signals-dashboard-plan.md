# Axiom signals dashboard: plan (PLAN ONLY, no code until marcus's named GO)

Job: marcus m67349 (2026-10-13 17:35Z, room axiom-dashboard-2026-10-13), from coxwell 17:3xZ.
Branch: kai/axiom-signals-dashboard-2026-10-13, off main 544f6fc. Reviewer: fable. Author: kai.

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
  entry_px numeric,                                                 -- null until scored (see stamp)
  exit_px numeric,
  move numeric,          -- signed, in the symbol's unit (pips FX, points XAUUSD/US30), + = in the call's favour
  outcome text check (outcome in ('right', 'wrong', 'flat')),
  meta jsonb not null default '{}'::jsonb,                           -- source-specific: confidence, card id, ...
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

Plus the schema_migrations ledger row, begin/commit, and 0110_rollback.sql (drop table) as 0105/0107 do.
The stamp CHECK is conjoined equalities, not `a = b = c` (0107:9 note).

Choices for fable:
- C1 Unique key (source, symbol, entry_ts), not (source, symbol, session_date): the same table then takes
  an intraday or weekly source (COT is weekly) without a migration. Axiom's daily card is one window a day
  per symbol, so for Axiom the two keys are the same thing.
- C2 Multi-source: `source` is a format CHECK in SQL and an allowlist in code (ingest, section 4). Adding a
  source = a reviewed commit plus one env var, no migration. Anything a source has that the shared columns do
  not (sentiment score, confidence, COT net position) goes in `meta`; the page reads only shared columns.
- C3 A row can exist unscored: Axiom can register the call at call time (outcome null) and score it later
  (section 4). If Axiom only ever posts scored rows, nothing breaks; the page then reports every call as
  "registered after the fact" (section 5), which is accurate.
- C4 Immutability is enforced in the ingest code (refuse, 409), not a trigger: the repo has no trigger to
  copy, and corrections are rare enough to be a SQL file to marcus (CLAUDE.md rule 4). Fable may rule a
  trigger instead.

Not in 0110: price bars for the 4H chart. See S5 and Q4. If marcus answers Q4 yes before S1, I add
`signal_bars (source, symbol, tf, ts, o, h, l, c, unique (source, symbol, tf, ts))` to 0110 so it is one
apply, not two.

## 4. Ingest: POST /api/signals/ingest

- Route file src/app/api/signals/ingest/route.ts, logic in src/lib/signal-ingest.ts (testable without Next).
- proxy.ts matcher excludes /api (src/proxy.ts:172), so the route's own gate is the only gate. Order, as
  agent-api.ts:105:
  1. `VERCEL_ENV !== "production"` -> 404. Previews share the production DB, so a preview must not write.
  2. Token: `Authorization: Bearer <token>`, token >= 32 chars. Each source has its own env var holding the
     sha256 hex of its token, e.g. `SIGNAL_INGEST_SHA256_AXIOM`. Code map: `{ axiom: "SIGNAL_INGEST_SHA256_AXIOM" }`.
     The token's hash is compared with timingSafeEqual against the env var of the `source` named in the body.
     A token is bound to its source: the axiom token cannot write sentiment rows. Missing or malformed env
     -> 401 "not configured". The token is generated on Ubuntu-Axiom; only its sha256 goes into Vercel env.
  3. Optional `SIGNAL_INGEST_ALLOWED_IP_AXIOM`: if set, x-forwarded-for first hop must match (agent-api's
     rule). Default unset: this route writes one non-money table, and Ubuntu-Axiom's egress IP is unknown to me (Q7).
- Body: content-type application/json, cap 64 KB, strict (unknown fields refused):
  `{ "source": "axiom", "calls": [ { symbol, sessionDate, direction, entryTs, exitTs, entryPx?, exitPx?, move?, outcome?, meta? } ] }`
  1 to 200 calls per POST, so the history backfill is a loop of POSTs.
- Per call, one upsert on (source, symbol, entry_ts), all calls in one transaction:
  - new row: insert. `received_at` = now().
  - same row, identical: no-op ("unchanged").
  - unscored row gets its scored form: update exit_px/move/outcome/entry_px, scored_at = now().
  - direction, session_date or exit_ts differs from the stored row: 409, whole batch rolled back.
  - already scored and the scored values differ: 409. A rescoring is a correction, and corrections go to
    marcus as SQL.
- Outcome cross-check: the portal recomputes the outcome from entry_px, exit_px, direction and its own
  instrument table (src/lib/signal-instruments.ts: unit size and dead-band per symbol; marcus m67349: under
  5 pips FX, under $2 XAUUSD, under 20 pts US30 = FLAT). If the portal's outcome or move disagrees with the
  one Axiom sent: 422 with both values. Reason: the page must not show a number it cannot reproduce, and two
  scorers drifting apart is a bug to see on day one, not to find in a month. (Fable: refuse vs store-and-flag.)
- Response: `{ inserted, scored, unchanged }` counts, or the error and the index of the failing call.
- docs/signal-ingest.md: the contract, the curl line, token generation, the retry rule.

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
  1. Headline: calls / right / wrong / flat / pending / hit %, with the first and last session_date, and
     "N of M calls registered before their window opened" (received_at < entry_ts).
  2. Per-pair table: calls, hit %, net move in the pair's unit if every call was followed, avg move when
     right, avg move when wrong, buy hit % (n), sell hit % (n). Under 10 scored calls: an "n<10" tag on the
     row and its percentages muted.
  3. Cumulative hit rate over time (one line, all pairs), and cumulative net move PER PAIR (one line per pair).
     Not one summed line: 5 FX pips and 20 US30 points are different units, so a sum across pairs is not a
     number. (If coxwell wants one line, the honest one is move / dead-band per call; a decision for marcus.)
  4. Per-pair chart with each call marked: see S5.
- Hit % = right / (right + wrong); flats are counted and shown, not in the denominator. This must equal
  track_record.py's definition or the page and Axiom's own report disagree in front of coxwell (Q2).
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
| src/app/api/signals/ingest/route.ts | S2 |
| docs/signal-ingest.md | S2 |
| src/lib/signal-stats.ts (pure), signal-stats.test.ts | S3 |
| src/lib/signal-calls.ts (the page's one read query) | S4 |
| src/app/admin/signals/page.tsx, signals.css | S4 |
| src/components/admin/signal-charts.tsx | S4, S5 |

## 7. Tests (node:test, the repo's runner line `npx tsx --test <file>`)

- S1 signal-calls-0110.test.ts, pglite, the consult-0105.test.ts shape (applies every migration in order,
  then 0110): good row in; each CHECK refuses its bad row (direction, source format, window, each arm of the
  stamp); the unique key refuses a second call for the same window; rollback drops cleanly and its ledger row.
- S2 signal-ingest.test.ts: gate (non-production 404; env unset 401; malformed hash 401; short token 401;
  wrong token 401; axiom token naming source 'sentiment' 401; source assertion that the compare is
  timingSafeEqual, as agent-api.test.ts:227); body (unknown field, 201 calls, 64 KB + 1, bad date, bad
  direction); upsert (register then score; identical repost unchanged; changed direction 409 and nothing in
  the batch written; rescoring 409); dead-band edges per class: exactly 5.0 pips not FLAT, 4.9 FLAT, a JPY
  pair's pip, XAUUSD $2.00 vs $1.99, US30 20 vs 19.9; outcome mismatch 422.
- S3 signal-stats.test.ts: a hand-built fixture of about 14 calls over 3 pairs with every expected number
  written out by hand in the test (headline, per pair, buy/sell split, avg right/wrong, the n<10 flag at 9
  and 10, cumulative series in date order, flats outside the hit % denominator, pending outside everything).
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
| S1 | 0110 + rollback + pglite test | ~180 | Q1 (number), Q4 (bars in or out) |
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
- R3 the Axiom side builds the poster and the history backfill from docs/signal-ingest.md. Not my box.
- R4 Leo or marcus merges. I never merge.

## 9. Questions for marcus (answers from the files, not from memory)

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
