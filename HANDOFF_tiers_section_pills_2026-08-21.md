# Tier page jump-nav pills — shipped, deploy blocked

**Thread:** leo-tiers-page-menu-nav-pills-2026-08-21
**Commit:** cc7d6fd (pushed to origin/main)

## What shipped
- New `<SectionPills>` component (`src/components/shared/section-pills.tsx`) — reusable, `scrollIntoView` behavior, not coupled to filter state.
- New CSS classes `.sec-pills` / `.sec-pill` in `portal.css` (education's `.chip` pattern reused visually, but with a **cyan** accent on hover/active per coxwell's callout, instead of emerald).
- Wired into `/feeds/[region]/tiers` (shared component, so both London and NY get it): pill row placed directly under the subtitle line, above the server registration banner.
- Pills shipped: `{region} Feeds` → `#tiers`, `Compare` → `#comparison`.

## Open item — label wording
- Went with the bus message's safe defaults, adapted: `London Feeds` became `${regionName} Feeds` (dynamic) since the page is shared across regions — a hardcoded "London Feeds" would be wrong on the NY page.
- **`Coming Soon` pill NOT shipped** — that section doesn't exist on the tiers page yet (ITCH teaser is still design-only, see `project_horizon_itch_coming_soon_2026-08-21` memory). Add a third pill + `id="coming-soon"` wrapper once that card lands.

## Verification status
- `tsc --noEmit` clean on touched files.
- Pushed to origin/main (cc7d6fd).
- **`vercel deploy --prod` blocked** — command required approval and was not granted in this session (known pattern, see `feedback_deploy_execution_blocker` memory). Not deployed yet; no live screenshot possible.
- No live/visual verification done. Next agent/session with deploy access should run `vercel deploy --prod --yes`, confirm the pills render and scroll correctly on both `/feeds/london/tiers` and `/feeds/[ny-region]/tiers`, and grab a screenshot for the thread.
