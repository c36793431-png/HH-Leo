# Partner V3 logo swap + 0054 migration backfill — 2026-08-22

Bus thread: leo-partner-page-broken-auth-buttons-2026-08-22 (marcus, relaying coxwell + FOC16).

## Shipped

Commit `3be12ca`, pushed to `origin/main`.

1. **Header logo swap** (`src/app/partner/page.tsx`, `src/app/partner/partner-landing.css`):
   swapped the minimal cyan line-glyph in the partner V3 top-left nav for the canonical
   Horizon HFT brand mark — `public/brand/horizon-logo-paid.png`, the same blue/cyan/gold-apex
   mark used in `src/components/portal/sidebar.tsx` for portal.horizonhft.com's own header.
   Removed the `.pv-brand .glyph` gradient/box-shadow background (was styled for the flat SVG
   line icon; clashes with the full-color raster mark). Everything else about the V3 layout
   is untouched — wordmark, subtitle, nav links, hero, etc. all as before.

   Didn't wire the sidebar's own `onError` free-logo fallback here — `partner/page.tsx` is a
   server component (uses `await auth()`), so that client-only `useState` fallback pattern
   doesn't transplant directly; static `/brand/horizon-logo-paid.png` reference is fine since
   it's a real asset already deployed and used elsewhere.

2. **0054 migration bookkeeping backfill** (`db/migrations/0054a_backfill_migration_row.sql`):
   one-line idempotent insert —
   `insert into schema_migrations (version, name) values ('0054', '0054_tier_waitlist.sql') on conflict do nothing;`
   — fixing the gap FOC16 flagged (0054 was pasted live without its tracking insert, so
   `schema_migrations` has 0055 but not 0054). `tier_waitlist` table itself already exists
   live; this only fixes the tracking row. Shipped as its own migration file per marcus's
   suggested option, not appended to 0054's original file.

## Blocked

- **Deploy**: `vercel deploy --prod --yes` was auto-denied in this session (consistent with
  the known deploy-execution-blocker pattern in this environment — DB/network/chmod calls get
  auto-denied in some sessions). Code is pushed to `main`; someone with deploy access needs to
  promote it, or the next auto-deploy-on-push will pick it up if that's wired for this repo.
- **DB backfill**: per marcus's note, coxwell will paste the 0054a SQL directly — not run from
  here, no live DB access attempted.
- **Bus reply**: attempting via SendMessage; if it doesn't land, this file is the fallback
  record, per standing file-handoff-fallback protocol.
- **Live/visual verify**: not done (no deploy). Should sanity-check the mark renders cleanly
  against the dark `.pv-nav` backdrop-blur bar (transparent-PNG mark, no added background box)
  and doesn't overflow the 42x42 slot once live.

## Open (not in this task's scope, per marcus)

- `referred_by` attribution check on signup — still on the list per FOC16's caveat, not
  blocking anything today.
