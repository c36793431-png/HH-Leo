# Partner approve now seeds a `partners` row — 2026-08-22

Bus thread: `leo-partner-page-broken-auth-buttons-2026-08-22`.

## Status: shipped + pushed as f9ad638

Coxwell tested end-to-end and hit "No partner record is linked to this account yet." on
`/partner/dashboard` after approving a self-serve `partner_applications` row. Root cause:
`approvePartnerApplication` flipped `users.role='partner'` but never touched the old
`partners` table (0045, individually-negotiated deals), which the dashboard reads from.

## Fix (option a, per marcus's lean)

`src/lib/partner-applications.ts` — after role promotion (both the already-had-user-id
path and the hybrid re-check/create path), seed a `partners` row via the existing
`createPartner`/`getPartnerByUserId` helpers in `src/lib/partners.ts`. Idempotent —
skips if a row already exists for that `user_id`.

## Default terms — there isn't a tier field to default

`partners` itself has no tier/commission column (`name`, `handle`, `email`, `user_id`,
`status` only). Split terms live on `partner_deals` rows, created lazily per-payment by
`recordAutoPartnerPayment`, which already has a standing default:
`DEFAULT_PARTNER_PCT = 0.6` / `DEFAULT_COXWELL_PCT = 0.4` (`src/lib/partners.ts`). So a
newly-approved self-serve partner gets the same 60/40 split as the manually-onboarded
one, automatically, the first time a referred client pays — no separate "Tier I" default
needed or invented.

## Known follow-on risk (not fixed this pass — flagging, not touching)

`getActivePartnerReferralCode()` (`src/lib/partners.ts`), used by `proxy.ts` to set the
`hz_ref` cookie on `partner.horizonhft.com` visits, assumes exactly one active partner
row (`order by created_at asc limit 1`) — already commented as a known gap. Before this
change there was only ever one manually-onboarded partner, so it didn't bite. Now that
self-serve approval can create a second (and third...) `partners` row, every approved
partner past the first will have their subdomain traffic silently attributed to whoever
has the oldest row instead of themselves. Needs a host->partner lookup before a second
self-serve partner goes live for real; flagging to marcus/coxwell rather than scope-
creeping it into this fix.

## Verify

`npx tsc --noEmit -p tsconfig.json` clean. No migration needed (partners table already
exists). Not smoke-tested end-to-end (no DB/network access this session) — recommend
coxwell re-run the same incognito approve → dashboard check that surfaced the bug.
