# HANDOFF — Compact Dashboard Signal Feeds (coxwell-approved Variant A)

**Thread:** horizon-portal-v2051-polish-2026-08-13
**Status:** shipped, pushed, deployed to prod. Bus reply + live screenshot blocked this session.

## What shipped

Commit `ba2fe37` on `main`, pushed and deployed:
- Prod: https://portal.horizonhft.com/dashboard (aliased, deployment `dpl_6KzmyLqJbABas1TrKbCcMJtd8Cmn`, READY)

Replaced the `/dashboard` "Signal Feeds" section (previously 4 cards with
region name + subtitle + "Not included — contact us to add") with Iris's
compact row-card variant per coxwell's pick (Variant A):

- Per card: flag icon + region name + state pill (top-right) + single-line
  stat below name + action link (bottom-right).
- 4-column grid, 2-col at ≤768px, 1-col at ≤480px (new breakpoint added).
- State pill matrix, exactly per spec:
  - Owned + active/trial/admin-included → `● ACTIVE` (green) + `See tiers →`
  - Not owned, region has a tier catalogue (`feed_tiers` rows ≥ 1) →
    `● N TIER(S)` (cyan) + `See tiers →`
  - Not owned, no tier catalogue yet (CME/Tokyo today) → `● LOCKED` (red) +
    `Upgrade →` (Telegram)
- `See tiers →` routes to `/feeds/[region]/tiers` when the region has ≥2
  tiers (drill-in page requires that or 404s); falls back to `/feeds`
  otherwise so it never links to a 404.
- Feeds tab (full `/feeds`) untouched — still the richer Screen 1 variant.

### Files changed
- `src/app/dashboard/page.tsx` — new `signalFeedCards` derivation (reuses
  `computeFeedCardStatus` from `feeds-catalogue.ts`, `regionForFeedType`
  from `feed-tier-catalogue.ts`, tier counts from `feed-tiers.ts`), new
  compact card JSX (`.sf-card`/`.sf-top`/`.sf-pill`/`.sf-stat`/`.sf-action`).
- `src/app/portal.css` — replaced `.feed-card`/`.fc-*` rules with `.sf-*`
  compact row-card rules; added `@media (max-width: 480px)` 1-col stack.
- `src/lib/feed-tiers.ts` — new `getBestLatencyByRegion()` (min
  `latency_us` per region, excluding nulls).

## Open item: stat-line data doesn't match Iris's mock example numbers

Iris's mock examples (`0.42ms · CME AURORA DC3`, `0.38ms · EQUINIX LD4`,
`0.31ms · EQUINIX NY4`, `0.55ms · EQUINIX TY3`) don't exist anywhere in
the codebase or DB — grepped for "AURORA"/"EQUINIX", no hits except an
unrelated placeholder string in a form. The real venue codes are
`CH1`/`LD4`/`NY4`/`TY3` (`FEED_TYPE_META` in `licenses.ts`), and real
per-tier latency (`feed_tiers.latency_us`, migration 0035) only exists
for London (best = 18µs on LD Delta 18) — NY's two tiers both have
`latency_us = null` ("pending, not yet exposed by the client" per the
migration's own comment), and CME/Tokyo have **no tier rows at all**
(already flagged open in the LD/NY tier cards HANDOFF from earlier
today — `project_horizon_ld_tier_cards_2026-08-13`).

I did **not** fabricate ms figures to match the mock. Instead:
- Where a real `latency_us` exists: `{value}µs · {coloCode} co-lo` (e.g.
  `18µs · LD4 co-lo`).
- Where none exists yet: just `{coloCode} co-lo` (e.g. `NY4 co-lo`,
  `CH1 co-lo`, `TY3 co-lo`).

**Ask for marcus/coxwell:** confirm whether real ms-precision latency
figures are coming for NY/CME/Tokyo soon, or whether coxwell wants
placeholder numbers in the interim. Also confirms my LOCKED/upgrade-only
treatment of CME (`futures`) and Tokyo (`crypto`) is correct — they have
no `feed_tiers` rows and `futures` isn't even mapped to a `FeedRegion` in
`FEED_REGION_TYPE` (`cme: null`), so it can never get a tiers drill-in
until that catalogue is built.

## What's blocked in this session

- **Bus reply**: `SendMessage(to: "marcus", ...)` returned "No agent
  named 'marcus' is reachable" — same blocker pattern as other recent
  HANDOFFs today (sidebar colored icons, LD tier active-state).
- **Live screenshot / curl of the deployed URL**: outbound network calls
  (`curl https://portal.horizonhft.com/dashboard`) require approval that
  auto-denies in this session — consistent with the known deploy-execution
  blocker pattern. `npm run build` passed clean locally and I reviewed the
  rendered JSX/CSS by hand; no runtime verification against a live browser
  was possible here.

**Next step for whoever picks this up:** confirm the live render on
`portal.horizonhft.com/dashboard` with a screenshot and reply on the
`horizon-portal-v2051-polish-2026-08-13` thread with commit + deploy +
screenshot per marcus's ask, and relay the open latency-data question
above.
