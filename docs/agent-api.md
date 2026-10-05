# Agent API: `/api/agent/trial` and `/api/agent/feed`

Marcus's agent on claw1 grants a client a **trial licence** or **one feed tier** without holding
any prod secret. Scope: m60807. Design verdict: Fable m60833 (C1-C7). Build go: marcus m60835.
Code: `src/lib/agent-api.ts` and the two route files. Ledger: `agent_grants` (migration 0095).
Wrapper: `scripts/agent-api.sh`.

Each route runs the same plan/execute code as the CLI (`assign-trial.ts`, `assign-feed.ts`), and
so the same grant functions as the admin panel. The two overrides (internal/test accounts, repeat
trials) are **not reachable**. Those stay in the panel.

Part of this setup lives outside git (the WAF rules and the env vars). This file is their record.

## Setup, in this order (fable C1)

coxwell does steps 3 and 5 in the Vercel dashboard. marcus sequences them, after Fable passes the
build. Never set the token hash before the WAF allowlist is proven.

1. **marcus applies** `db/migrations/0095_agent_grants.sql` and `scripts/seed-agent-actor.sql`.
   Both are additive. The routes refuse every execute while the actor row is missing (C7).
2. **Merge.** With no env vars set, both routes answer every request with
   `401 {"error":"agent api not configured"}`. Previews answer 404, whatever their env.
3. **coxwell creates two Firewall custom rules**, project horizon-portal. Order them as listed:
   - **A. `agent-api kill switch`**: if Request Path *starts with* `/api/agent`, then **Deny**.
     Save it **DISABLED**. It sits above B.
   - **B. `agent-api claw1 only`**: if Request Path *starts with* `/api/agent` AND IP Address
     *is not* `88.99.67.48`, then **Deny**. Enabled. claw1 is IPv4-only (marcus m60811). If
     Hetzner ever changes that IP, this rule blocks claw1: the failure is closed.
   - Publish. Rule changes take effect without a deploy.
4. **Prove B before any token exists.**
   - From any machine that is not claw1:
     `curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://portal.horizonhft.com/api/agent/trial`
     must return Vercel's deny (403), not the route's JSON.
   - From claw1, the same POST must reach the route: `401 {"error":"agent api not configured"}`.
5. **Token.** On claw1, marcus runs:
   ```
   umask 077; mkdir -p ~/.config/horizon
   openssl rand -base64 32 | tr -d '\n' > ~/.config/horizon/agent-api-token   # 32 random bytes
   chmod 600 ~/.config/horizon/agent-api-token
   scripts/agent-api.sh token-hash            # prints ONLY the sha256
   ```
   He sends coxwell only the hash. The token itself never leaves claw1: not on the bus, not in Vercel.
   coxwell then sets these, **Production scope only**, and redeploys:
   - `AGENT_API_TOKEN_SHA256` = that hash
   - `AGENT_API_ALLOWED_IP` = `88.99.67.48` (the second layer under rule B, C3)
   - Check, by key name only, that `TELEMETRY_BOT_TOKEN`, `HORIZON_PORTAL_BOT_TOKEN`,
     `AUTH_RESEND_KEY` and `EMAIL_FROM` exist. The trial plan refuses with "Missing env" otherwise.
6. **Smoke test**, from claw1:
   - Pointed (via `AGENT_API_TOKEN_FILE`) at a 0600 file holding some other 44-character value, a
     plan must get `401 {"error":"unauthorized"}`.
   - `scripts/agent-api.sh trial plan --user <a client email> --days 7 --feeds london` must return
     `200` and `would_grant` or `would_refuse`, with `capRemainingToday`.
   - `scripts/agent-api.sh feed plan --user <a client email> --tier ld-beta-56` likewise.
   - A plan writes nothing. Do not execute as a smoke test.

## Revoke, fastest first (fable (e))

1. **Enable rule A** (Save + Publish): instant, no deploy.
2. marcus deletes the token file on claw1.
3. coxwell blanks `AGENT_API_TOKEN_SHA256` and redeploys (minutes). After any incident, rotate:
   generate a new token (step 5). The WAF only hides the door; the hash is the lock.

## Requests

`POST`, `content-type: application/json`, body at most 4 KB, `Authorization: Bearer <token>`.
Unknown fields are refused (400).

| route | fields |
|---|---|
| `/api/agent/trial` | `mode` (`plan`/`execute`), `idempotencyKey` (execute only), `user` (uuid or email), `days` (1-90), `feeds` (non-empty, unique, from futures/london/ny/crypto) |
| `/api/agent/feed` | `mode`, `idempotencyKey`, `user`, `tierKey` |

`idempotencyKey` matches `[A-Za-z0-9_-]{16,64}`. The wrapper derives it as
sha256(`action|user|params|UTC date[|attempt=N]`). A retry of the same request on the same day
therefore reuses the key and cannot grant twice.

## Answers (C5)

The answer carries `status` and, where relevant, `refusals`, `userId`, `capRemainingToday` and
`note`, plus one summary:
- `trial`: expiry, feeds, the delivery channel name, licence numbers and status.
- `feed`: tier, would-be outcome, licence number and expiry, whether a server is registered,
  and the existing row's status.

The answer never contains a licence key, the key message, a Telegram id, a server IP or a provider
email.

| status | HTTP | meaning |
|---|---|---|
| `would_grant` / `would_refuse` | 200 | plan |
| `granted` | 200 | written; coxwell pinged |
| `refused` | 200 | nothing written; a log line, no ping |
| `not_granted` | 200 | a reconcile found nothing landed: send again with `--attempt N+1` |
| `in_flight` | 409 | the same key is still running: retry the same key after 120 s |
| `in_doubt` | 500 | the outcome could not be recorded; coxwell pinged |
| `error` | 400/401/403/404/409/413/415/500 | gate or body; a 409 here means the key was used for a different request |

A same-key request after a settled answer gets that answer back, with `"replayed": true`.

## Idempotency and "in doubt" (fable C2, C4)

- The ledger row (`pending`) commits **before** the grant's transaction opens. That transaction
  holds `pg_advisory_xact_lock(0x48484147)` on a dedicated connection across the daily-cap count,
  the plan, the grant and the outcome write. Concurrent agent grants run one at a time, so two keys
  for one client cannot both pass the "no active licence" check.
- If the grant throws, the route reads the database under the same lock. The `admin_actions` row
  carries the key (`details.via = "agent-api"`, `details.idempotencyKey`). Failing that, a licence
  or subscription written since the ledger row counts. Either way it answers `granted` with a note,
  or `not_granted`.
- If even the outcome write fails, the answer is `in_doubt` and the row stays `pending`. Send the
  **same** key again after 120 s (2 x maxDuration): that reconciles it the same way and pings coxwell.
- **What a reconcile cannot settle:** a trial was issued, but whether the key DM/email went out is
  not recorded, because the key is sent after the insert. The answer says so. Check
  `/admin/users/<id>` and resend from the panel.

## Limits

- **Caps** (constants in `agent-api.ts`, fable (d)): **5 trials and 5 feed grants per UTC day**.
  Pending and granted executes count. Refused, failed and plan calls do not. Raising a cap is a
  reviewed commit.
- **Pings** (C6) go to coxwell (chat 7225949234) on every write and every reconcile/in-doubt:
  actor, action, target, outcome, the key's first 8 characters, time.
- **A feed grant tells nobody**, the same as the panel's Grant. The provider still allowlists the
  client's server IP by hand. The answer omits the IP (C5), so read it from `/admin/users/<id>`.
- **Concurrency is unmeasured.** The tests run on a single-session PGlite, so the lock is proven by
  statement order (`agent-api.test.ts`), not by two live sessions.
