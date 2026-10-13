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
- Two first validates racing on one unbound key: one statement binds and records, so under READ COMMITTED the second
  waits on the row lock, re-reads the winner's binding and keeps it. That is correct by Postgres semantics but NOT
  measured: the tests run on one PGlite session (Fable m63564, delta 5).
- `/v1/hb` never binds: its `hid` stays telemetry in `client_heartbeats`.
- `/admin/licenses`: **Reset PC** on any bound row (confirm step). Clears `hardware_id` and `hardware_bound_at`
  (and, since 0111, `hardware_id2` and `hardware_id2_bound_at`), keeps `activated_at` and the seen rows, writes
  `admin_actions` `admin_licenses_reset_hwid` with `previousHardwareId` and `previousHardwareId2`. Refuses on a
  licence with neither bound and writes nothing.

## 2.0.9: the second identity (`0111_license_hwid2.sql`)

HWID wire contract v2 (`wire-contract-hwid-v2.txt`, md5 687b1ef7, Fable PASS m67592), sections 3.1-3.6 and 3.8
(C1-C5). Enforcement is still `HWID_ENFORCE`, OFF.

- `/v1/validate` accepts two optional fields. `hardwareid2` (hid2) counts only if it matches `^[0-9A-F]{32}$`.
  `hwdegraded` counts only if it is comma-separated tokens from `cpu,disk,mac,guid,uuid`, at most 32 chars. Any other
  value is treated as absent, never a 400.
- **One** bound hid2 per licence (`licenses.hardware_id2`), set once, in the same statement as the hid. It binds only
  while the licence has no bound hid, or the request's hid IS the bound one (S2). The mirror rule also holds: the hid
  binds only while no hid2 is bound, or the request carries the bound one.
- A **fallback hid** is one where `hwdegraded` names cpu, disk or mac, or the hid starts `HWID-ERROR-`. It never binds
  and is never refused (S3).
- The match runs in this order (3.4): both sides have a hid2, so the hid2 alone decides (a). Otherwise a fallback hid
  passes (b). Otherwise the hid decides, exactly as for 2.0.8 (c).
- `activated_at` is set by the first binding of EITHER identity, so a hid2-only bind (degraded first validate) stamps
  it too. Reset PC never clears it.
- `license_hwid_seen.last_hwid2` / `last_hwdegraded` record what the latest validate from that (licence, hwid)
  carried (C4). This is the read for the separate enforcement-ON decision.
- `/v1/hb` is unchanged: `hid2`/`hdg` land in `client_heartbeats.raw` only (C3).
- The pre-flip rebind SQL below predates 0111 and moves the hid only. For a 2.0.9 client with a bound hid2, the hid2
  still decides.

### ON-decision notes (read before turning `HWID_ENFORCE` on)

- **Would lock on ON** (Fable N2, m67592). A licence bound to hid A by 2.0.8 whose owner's hid then changed for good
  (adapter order, USB disk) never binds a hid2 under OFF (S2), so under ON its next clean validate is a 3.4 c) mismatch.
  The remedy is Reset PC. This read-only query lists the active licences whose LATEST validate would be refused today:
  a hid bound, no hid2 bound, and the latest seen row is a clean hid that is not the bound one. Rows = the count.

  ```sql would-lock
  with latest as (
    select distinct on (s.license_id) s.license_id, s.hwid, s.last_hwdegraded, s.last_seen, s.last_version
    from license_hwid_seen s
    order by s.license_id, s.last_seen desc, s.hwid
  )
  select l.id as license_id, l.hardware_id as bound_hid, t.hwid as latest_hwid, t.last_seen, t.last_version
  from licenses l join latest t on t.license_id = l.id
  where l.status <> 'revoked' and l.expires_at > now()
    and l.hardware_id is not null and l.hardware_id2 is null
    and t.hwid <> l.hardware_id
    and left(t.hwid, 11) <> 'HWID-ERROR-'
    and coalesce(t.last_hwdegraded, '') !~ '(^|,)(cpu|disk|mac)(,|$)'
  order by l.id;
  ```

  `src/lib/license-hwid.test.ts` test 35 runs this block and checks each row against what ON actually answers.
- **G2, a sharing gap, not a lockout.** Under ON, a licence with only a hid2 bound (its first validate was degraded,
  so no hid bound) passes ANY request that carries no hid2: 3.4 c) has no bound hid to compare. It closes when the
  owner's clean validate binds the hid. It can be permanent (Fable N3): if the owner's uuid later becomes a definite
  non-usable answer (a BIOS update blanks it), hid2 is absent for good, the mirror guard never lets the hid bind, and the
  licence stays hid2-only. Still never a lockout. Count them with
  `select count(*) from licenses where hardware_id is null and hardware_id2 is not null`.

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

Only activity since the current binding counts (Fable m63564 S1): a key must be bound (`hardware_bound_at` set), and
a row is a candidate only if `last_seen >= hardware_bound_at`. Reset PC keeps the seen rows, so without this the
apply would undo an admin's reset: a reset key not yet re-validated would go back to the old PC, and so would a key
re-bound to a new PC that the old PC's older hits outnumber. A reset key that has not validated since is skipped and
binds itself on its next validate.

The apply also skips a hwid first seen before the current binding, unless it is the bound one (marcus m63582,
ruling b). `hits` count all time, so without this an old PC that validates once after a move would win back the key
on its pre-move hits. The preview still lists such a key, with `seen_before_binding = true`, so a human reads why.

`apply_target` is the binding the key will have after the apply (marcus m63585, ruling i). The preview computes it
with the apply's own `ranked` CTE, copied verbatim (the test checks the copy), so it is exactly what the apply does:
`apply_target = bound_now` means the apply leaves the key alone. It can differ from `dominant`: if the old PC is
dominant but flagged and a third PC has validated since the move, the apply moves the key to the third PC. Every key the
apply moves is listed: if the bound hwid were the dominant, it would also rank first among the apply's candidates.

For marcus (Fable N1): when two clean PCs genuinely share one key, the apply rebinds it to whichever PC validated
more, the heavier user. The SQL cannot tell that case from drift; read the preview, and that is where a human spots it.

Preview (read-only):

```sql
with seen_rank as (
  select s.license_id, s.hwid, s.hits, s.first_seen,
         row_number() over (partition by s.license_id order by s.hits desc, s.last_seen desc, s.hwid) as rn
  from license_hwid_seen s join licenses l on l.id = s.license_id
  where left(s.hwid, 11) <> 'HWID-ERROR-'
    and l.hardware_bound_at is not null and s.last_seen >= l.hardware_bound_at
), ranked as (
  select s.license_id, s.hwid,
         row_number() over (partition by s.license_id order by s.hits desc, s.last_seen desc, s.hwid) as rn
  from license_hwid_seen s join licenses l on l.id = s.license_id
  where left(s.hwid, 11) <> 'HWID-ERROR-'
    and l.hardware_bound_at is not null and s.last_seen >= l.hardware_bound_at
    and (s.first_seen >= l.hardware_bound_at or s.hwid = l.hardware_id)
)
select l.id as license_id, l.hardware_id as bound_now, d.hwid as dominant, d.hits,
       d.first_seen < l.hardware_bound_at as seen_before_binding,
       coalesce(a.hwid, l.hardware_id) as apply_target
from seen_rank d join licenses l on l.id = d.license_id
left join ranked a on a.license_id = l.id and a.rn = 1
where d.rn = 1 and l.hardware_id is distinct from d.hwid
order by l.id;
```

Apply (one transaction; idempotent, a re-run changes 0 rows):

```sql
begin;
with ranked as (
  select s.license_id, s.hwid,
         row_number() over (partition by s.license_id order by s.hits desc, s.last_seen desc, s.hwid) as rn
  from license_hwid_seen s join licenses l on l.id = s.license_id
  where left(s.hwid, 11) <> 'HWID-ERROR-'
    and l.hardware_bound_at is not null and s.last_seen >= l.hardware_bound_at
    and (s.first_seen >= l.hardware_bound_at or s.hwid = l.hardware_id)
)
update licenses l
set hardware_id = r.hwid, hardware_bound_at = now(), activated_at = coalesce(l.activated_at, now())
from ranked r
where r.license_id = l.id and r.rn = 1 and l.hardware_id is distinct from r.hwid;
commit;
```

These two blocks are run by `src/lib/license-hwid.test.ts` on PGlite (PG 17.5), so an edit here is tested.

## Backlog (rebind SQL)

The rebind docs thread is closed for scope (marcus m63585). Further edge cases go here as notes, not new review
rounds.

- **B1, second apply run** (Fable m63596, measured on 823cf52). The apply sets `hardware_bound_at = now()`, which is
  after every seen row, so a key it just re-bound has no in-window row of its own until that PC validates again. If one
  other PC validates in that gap, a second apply moves the key to it on 1 hit. Harmless for the planned single pre-flip
  run, and the window closes once the bound PC validates. If a second run is ever planned: candidate fix
  `hardware_bound_at = r.last_seen` instead of `now()`, so the chosen PC stays in its own window. Not built or tested.
