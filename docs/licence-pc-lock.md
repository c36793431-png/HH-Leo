# One licence, one PC: Phase 1 (observe-only)

coxwell GO 2026-10-09 via marcus m63368. Plan m63391 + m63392 + delta m63418; rulings m63383, m63396, m63419,
m63422; Fable's review m63552 (PASS WITH STRIKES); build GO m63554. Migration `0099_license_hwid_binding.sql`.

## What ships

- `/v1/validate`, for an **active** licence only: binds the licence to the first clean `hardwareid` it sees
  (`licenses.hardware_id`, `hardware_bound_at`, `activated_at` if unset) and upserts one `license_hwid_seen` row per
  (licence, hwid), the bound one included, with `hits`, `last_seen`, `last_version` and `last_ip`.
- `HWID-ERROR-<MachineName>` (the client's WMI total failure) is recorded but never binds, and on a bound key it is
  never refused (marcus m63419, option i).
- Expired, revoked and unknown keys: unchanged, nothing written.
- A database error in the bind/record step answers 500, never `hwid_mismatch`.
- `/v1/hb` never binds: its `hid` stays telemetry in `client_heartbeats`.
- `/admin/licenses`: **Reset PC** on any bound row (confirm step). Clears `hardware_id` and `hardware_bound_at`,
  keeps `activated_at` and the seen rows, writes `admin_actions` `admin_licenses_reset_hwid` with
  `previousHardwareId`. Refuses on an unbound licence and writes nothing.

## The flag: `HWID_ENFORCE` (env var, OFF at ship)

Vercel snapshots env vars per deployment. Changing one does nothing until the next deployment.

- **ON** = set `HWID_ENFORCE=1` (Production), then **redeploy the same sha**.
- **OFF** = unset it, then redeploy; **or** Instant Rollback to a deployment made before it was set.
- Only an exact `1` or `true` enforces. Anything else (unset, empty, `0`, `false`, `TRUE`, ` 1`) is observe-only.

Under enforcement, another clean hwid on a bound key gets a **signed HTTP 200** with `status: "hwid_mismatch"` and
`message`, everything else as today. Never a 404 (every client build deletes the saved key on a 404), never
`revoked`/`expired` (those halt a running session). Clients 2.0.5 to 2.0.8 show "unexpected status" at startup, ignore
`message`, and ignore the verdict mid-session, so the lock bites only at the next online startup. Enforcement waits for
2.0.9 (marcus m63422).

## Known limits until 2.0.9 (not closed by this job)

- One PC **per online startup**: a second PC that never restarts keeps running.
- Offline grace: `license.dat` + `license.receipt` copied to another PC can start offline for up to 7 days. During
  observe-only every PC receives a fresh signed receipt on every check, so on the day enforcement starts a second PC
  can still run offline for up to 7 days by blocking the server (Fable N4).
- Clones that keep the MAC send the same hash and both pass.

## The observe-only read (marcus, read-only)

```
select l.id as license_id, s.hwid = l.hardware_id as bound, left(s.hwid, 11) = 'HWID-ERROR-' as wmi_error,
       s.hits, s.first_seen, s.last_seen, s.last_version, s.last_ip
from license_hwid_seen s join licenses l on l.id = s.license_id
order by l.id, s.hits desc, s.last_seen desc, s.hwid;
```

A key whose bound row has few hits and another clean row has many is the "degraded first-seen" case (Fable S1).
Two alternating clean hwids from one `last_ip` fits an adapter reorder (VPN, Tailscale, Hyper-V) on one PC.

## Pre-flip step: rebind each key to its dominant clean hwid (NOT run; marcus applies, before turning ON)

Dominant = the clean hwid with the most hits; ties go to the most recent `last_seen`, then the hwid itself, so the
pick is a total order. `HWID-ERROR-` rows are never candidates. Licences with no clean row are left as they are.

Preview (read-only):

```sql
with ranked as (
  select s.license_id, s.hwid, s.hits,
         row_number() over (partition by s.license_id order by s.hits desc, s.last_seen desc, s.hwid) as rn
  from license_hwid_seen s
  where left(s.hwid, 11) <> 'HWID-ERROR-'
)
select l.id as license_id, l.hardware_id as bound_now, r.hwid as dominant, r.hits
from ranked r join licenses l on l.id = r.license_id
where r.rn = 1 and l.hardware_id is distinct from r.hwid
order by l.id;
```

Apply (one transaction; idempotent, a re-run changes 0 rows):

```sql
begin;
with ranked as (
  select s.license_id, s.hwid,
         row_number() over (partition by s.license_id order by s.hits desc, s.last_seen desc, s.hwid) as rn
  from license_hwid_seen s
  where left(s.hwid, 11) <> 'HWID-ERROR-'
)
update licenses l
set hardware_id = r.hwid, hardware_bound_at = now(), activated_at = coalesce(l.activated_at, now())
from ranked r
where r.license_id = l.id and r.rn = 1 and l.hardware_id is distinct from r.hwid;
commit;
```

These two blocks are run by `src/lib/license-hwid.test.ts` on PGlite (PG 17.5), so an edit here is tested.
