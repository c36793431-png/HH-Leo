# HANDOFF — /feeds supplement (coxwell catalogue + coming-soon/request/consulting)

**Thread:** horizon-portal-dedicated-feeds-page-2026-08-06 (supplement to m19185)
**Status:** shipped + pushed locally, deploy blocked

## What shipped (commit `0f7323c`, pushed to `main`)

1. **Confirmed catalogue** — renamed the 4 seed feeds and updated descriptions to match
   coxwell's spec (co-lo details), in `src/lib/licenses.ts` (`FEED_TYPE_META`) and
   `src/lib/feeds-catalogue.ts` (`FEED_CATALOGUE`):
   - CME Futures Feed — 🇺🇸 Chicago · CH1 co-lo
   - New York Feed — 🇺🇸 NY4 co-lo
   - London Feed — 🇬🇧 LD4 co-lo
   - Crypto Tokyo Feed — 🇯🇵 TY3 co-lo (was "Crypto Feed" / 🌐, now matches the
     confirmed catalogue)
   - These names also surface as chips on `/dashboard`, `/admin/users`, and
     `/admin/users/[id]` since they share `FEED_TYPE_META` — verified no other copy
     depended on the old names.

2. **What's Coming section** — new `COMING_SOON_CATALOGUE` array in
   `feeds-catalogue.ts`, shipped **empty** (coxwell to supply the roadmap list
   separately, per the dispatch). `/feeds` renders a "check back for what's next"
   placeholder when empty, and will auto-render a grey coming-soon grid the moment
   entries are added with `isLive: false`.

3. **Request a Feed CTA** — simple mailto card at the bottom of `/feeds`
   (`feeds@horizonhft.com`). No new DB table/form — kept v1 minimal per marcus's
   "your call" note.

4. **Consulting CTA** — visually distinct card (blue gradient border + "CONSULTING"
   badge, separate from the feed catalogue grid), links out to the Telegram channel.
   Copy matches the dispatch verbatim.

5. State-pill component (`computeFeedCardStatus`, 5 states: active/trial/included/
   locked/coming_soon) was already in place from the base `/feeds` build (fd67dc8) —
   no changes needed there, ready for Iris's spec.

`npx tsc --noEmit` and `next build` both pass; `/feeds` compiles.

## Not done / blocked

- **Deploy to prod** — `vercel deploy --prod --yes` auto-denied twice (same blocker
  as prior sessions, see `feedback_deploy_execution_blocker` memory). Work is
  committed + pushed; someone with deploy access needs to promote.
- **Visual treatment** — layout above is functional/default styling only. Waiting on
  Iris's mockup (msg `m19187`, thread horizon-portal-feeds-page-design-2026-08-06)
  for the final What's Coming / Request / Consulting visual spec before polishing.
- **Bus reply** — could not post back to the thread from this session; this HANDOFF
  is the fallback per the file-handoff protocol.

## Next steps for whoever picks this up

1. Deploy `main` (0f7323c) to prod.
2. When coxwell's roadmap list lands, populate `COMING_SOON_CATALOGUE` in
   `src/lib/feeds-catalogue.ts`.
3. When Iris's mockup lands, restyle `.fp-section`, `.fp-ctas`, `.fp-cta-card`,
   `.fp-consult-card` in `src/app/portal.css` to match.
