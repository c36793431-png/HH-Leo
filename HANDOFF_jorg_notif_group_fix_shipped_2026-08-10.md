# HANDOFF — Jorg signup-notif + paid-group bug: fixed, deployed, backfilled

**Thread:** jorg-signup-notif-and-paid-group-add-bug-2026-08-10
**From:** leo
**To:** marcus (SendMessage failed again: "No agent named 'marcus' is reachable" — filing via HANDOFF per fallback protocol)
**Status:** Complete. All authorized items done same session.

## Ack + ETA
Ack received 2026-08-10 (coxwell's gate decision + authorization). Done same session, ~40 min including verification.

## 1. Code fix — shipped

Commit `8dac6a7`, pushed to `main`, deployed to production (`portal.horizonhft.com`, deployment `dpl_GqyqFkEpdVRbCb2jY48pojWAnrJ3`, READY).

`issueNewLicenseAction` (`src/app/admin/users/actions.ts`) now, after `issueLicense(...)`:
- calls `notifyUser(...)` unconditionally (all 4 tiers get the "license is ready" DM/email)
- calls `sendPaidGroupInvite(...)` only when `isPaidTier(tier)` is true

New helper `isPaidTier()` in `src/lib/licenses.ts`: `tier === "paid" || tier === "team" || tier === "deal"`.

Typecheck clean (`npx tsc --noEmit`), no other call sites touched.

## 2. Jorg — backfilled

`notifyUser()` (gentle wording) + `sendPaidGroupInvite()` both fired for `jorgbuteijn@gmail.com`. Real single-use Telegram invite link generated and sent via DM (he has `telegram_user_id` linked). `group_memberships` row inserted, `status = 'invited'`. He's unblocked to join ⚡️HH-TRADERS.

## 3. Historical audit — other paid/team users issued via /admin/users

Queried all 8 `admin_users_issue_license` admin_actions (oldest 2026-07-28) joined to current license tier + `group_memberships`. Breakdown: 4 paid, 2 team, 2 trial (trial = Alonzo, legalclinton775 — left alone per instructions).

Backfilled (gentle-wording notif + invite attempt) for the non-Jorg paid/team users:

| user | tier | date issued | telegram linked | result |
|---|---|---|---|---|
| wsssss42 | paid | 2026-07-28 | yes | invite sent, `group_memberships` row inserted (`invited`) |
| senchuk.oleg@gmail.com | paid | 2026-08-02 | yes | invite sent, `group_memberships` row inserted (`invited`) |
| 741108888@qq.com | paid | 2026-08-10 (same day as Jorg, issued after) | no | no telegram linked → got the existing "link your Telegram" email fallback instead of a direct invite (same as a live user would get) |
| sahilsahu202@gmail.com | team | 2026-07-29 | no | same as above — email fallback only, no telegram to invite |

**Not touched — flagging for a decision:** `c36793431@gmail.com` (coxwell's own account, team tier, re-issued 2026-08-05). It already has a `group_memberships` row from 2026-07-30 with `status = 'removed_on_lapse'` — the old phantom-payment test row tied to the afafdd7 cleanup. Re-inviting your own account without asking felt like the wrong default. Say the word and I'll fire the same backfill for it.

Verified via a direct query after the run: exactly 3 new `group_memberships` rows landed (wsssss42, senchuk.oleg, jorg), all `status = 'invited'`.

## Scope pushback: did NOT touch `recordAutoPaymentForNewLicense`

Your dispatch also asked to extend the paid/team/deal tier-set to the `=== "paid"` check in `recordAutoPaymentForNewLicense` (the $100 finance auto-log hook), calling it a "latent bug." I looked into it and believe that's intentional, not a bug:

- `deal` tier is explicitly documented as barter/swap, non-revenue (commit `9718252ac4`: "never counted as revenue since payments stay keyed off actual payment rows").
- `team` tier is used for comps (commit `afafdd71026`: "e.g. comping a team-tier user").
- That same commit (`afafdd7`) already fixed a real incident where a team-tier comp license triggered a phantom $100 payment row — the fix was to make the hook strictly paid-only and delete the phantom row via a migration.

Extending the hook to team/deal would reintroduce exactly the bug `afafdd7` fixed — every team comp and every deal barter would silently log a fake $100 revenue row in `/admin/finance`. I left `recordAutoPaymentForNewLicense` and its inline `=== "paid"` check untouched, and only wired `isPaidTier()` into the group-invite gate (which is the right place for a "paid-adjacent tier" concept — group access isn't a revenue signal).

If coxwell specifically wants team/deal counted as revenue going forward, that's a real product decision, not a code-review nit — happy to make the change once that's explicit, but wanted to flag it rather than land it silently in the same PR.

## No other surprises / no blockers this run.
