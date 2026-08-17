# HANDOFF — Black trial + community bot build, 2026-08-17

**Ask:** marcus, bus thread `leo-portal-updates-bundle-2026-08-17` — coxwell green-lit all 7
open decisions on m21921b (Black trial) + m21391 (community bot), asked to build both.

## 1. Black trial (m21921b) — SHIPPED, pushed, deployed

Commit `9bbd5a3`. Migration `0041_black_trials.sql` applied to prod DB.

- **Gate**: paid-only, self-service, one-per-desk — `black_trials` has `unique(license_id)`,
  same mechanic as `server_registrations`. Requires a registered server first (`/account/servers`).
- **Request flow**: "Request Black trial" button on `/account/servers` → inserts a
  `requested` row → alerts coxwell on the existing telemetry-sink chat (reused
  `sendSinkMessage`, added `notifyBlackTrialRequested`).
- **Admin**: new `/admin/black-trials` page (sidebar nav added). Coxwell whitelists the
  server IP at BFF manually (outside portal scope), then pastes the endpoint/credentials
  BFF hands back into the "Activate" form along with trial length in days → sets
  `status='active'`, `expires_at`, DMs the client via the portal bot.
- **Config delivery**: portal secrets page, not bot DM — active trial's endpoint/credentials
  render directly on `/account/servers` once activated.
- **Expiry**: portal-tracked, `N days left` countdown computed client-side from `expires_at`.
  No cron marks it "expired" — an active trial past its date just flips the countdown text
  to "Trial expired" but keeps the upgrade CTA live (no functional difference, avoids a
  new cron job for an MVP).
- **Upgrade CTA**: "Upgrade to keep →" does **not** write to `feed_tier_requests` as
  literally described in marcus's answer #3 — that table's `region` check constrains to
  london/ny/cme/tokyo and would reject "black", and it has no `request_type` column. Built
  a `requestBlackTrialConversion()` that alerts coxwell directly instead (functionally the
  same outcome — an actionable ping to the desk — without forcing a schema mismatch).
- Greek codename: "Black" reused as-is; it's already rank #1 on the leaderboard shipped
  in `d620179` — no naming work needed.

Verified: `npx tsc --noEmit`, `next build`, and `eslint` all clean before pushing.

## 2. Community bot (m21391) — PARTIALLY shipped, one real blocker

Commit `ee675f7`, pushed, deployed. Migration `0042_group_memberships_tier.sql` applied.

**What's done:**
- `group_memberships` now has a `tier` ('free'|'paid') column; every read site that used
  to assume paid-only now filters `tier = 'paid'` explicitly (`licenses.ts`, `dashboard`,
  `community/page.tsx`, telegram webhook route) — prevents a mixed-tier bug once free rows
  start existing.
- `group-membership.ts` generalized: `sendGroupInvite(target, tier)` /
  `removeFromGroup(userId, telegramUserId, tier)`, with `sendPaidGroupInvite` /
  `removeFromPaidGroup` kept as thin back-compat wrappers so all 8 existing paid call
  sites (`admin/actions.ts`, `admin/users/actions.ts`, `dashboard/actions.ts`,
  `cron/expire-licenses`, `telegram/webhook`) are untouched.
- Audited for the "replaces the current direct banChatMember/unbanChatMember calls" line
  in the prior scoping doc — there is no such direct-bypass path. Every paid grant already
  goes through `sendPaidGroupInvite` (invite-link flow); ban/unban is only ever used for
  *removal* on lapse, which is correct and unrelated. Nothing to replace here.

**What's blocked — the free (Horizon Testers) group's join UI is unchanged:**
The free group is currently a static link (`portal_config.community_group_url`, resolves
to `https://t.me/+2LSFHZbapbNlODhk` — a *private* invite link). To bot-gate it the same
way as paid, the bot needs to be an **admin of that chat** and I need its **numeric
chat_id** — same as `TELEGRAM_PAID_GROUP_CHAT_ID` was manually supplied. A private `+...`
invite link cannot be resolved to a chat_id via the Bot API without the bot already being
a member; tested `getChatMember` against the public `@horizonhft` channel (a different
chat — the announcements channel, not Testers) and got "member list is inaccessible",
consistent with the bot not currently having admin access to either.

Flipping the free-join UI blind (no working chat_id) would break onboarding for every free
signup — held back deliberately rather than shipping something untestable in prod.

**Needed from coxwell before finishing this piece:**
1. Add `@horizonportalbot` as admin (with invite-link permission) to the Horizon Testers group.
2. Supply the numeric chat_id — set as `TELEGRAM_FREE_GROUP_CHAT_ID` in Vercel env.

Once that lands, the remaining work is small: wire `/community`'s free-group card to
`sendGroupInvite(target, 'free')` the same way the paid card already uses
`RequestInviteButton`/`sendPaidGroupInvite` — the backend is ready now.

**Existing members**: grandfathered by construction — no backfill script was written or
run, so pre-existing members of either group are untouched; only new joins after the
chat_id lands will route through the bot.

**DM consent**: implicit-on-signup per coxwell's answer — no code change needed here, it's
a portal T&Cs copy note. Did not check whether a T&Cs page exists to add that line; flagging
as a loose end rather than guessing at scope.

## Bus reply
Attempting `SendMessage(to: "marcus")` per usual — if it fails again (same recurring gap
noted across nearly every HANDOFF this month), this file is the fallback per
`communication_protocol` memory.
