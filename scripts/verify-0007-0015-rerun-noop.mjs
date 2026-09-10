/**
 * Read-only. Answers one question: if migrations 0007 and 0015 were re-pasted
 * verbatim right now, how many data rows would change?
 *
 * Both files are absent from schema_migrations despite carrying their own
 * self-insert, which means neither paste ever reached its tail. The fix is to
 * re-apply them for real (scripts/reapply-0007-0015-2026-09-10.sql) rather than
 * to backfill a ledger row on a guess -- but that is only safe while both
 * migrations are still no-ops against live data. This script measures that.
 *
 * Re-run it immediately before the SQL is pasted. 0015 sets tiers on four named
 * licenses; if any of them is changed via the /admin/licenses dropdown in the
 * meantime, re-running 0015 would silently revert that change and this script is
 * what catches it.
 *
 * Expected clean result: 0007 touches 0 rows, and all four 0015 statements report
 * 0 rows. Anything else means do not paste -- report it first.
 *
 *   node scripts/verify-0007-0015-rerun-noop.mjs
 *
 * Context: bus thread iris-black-trial-r2-ferry-2026-09-10, migration drift item.
 */
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

const envText = readFileSync('.env.local', 'utf8');
const match = envText.match(/^NEON_DATABASE_URL=(.*)$/m) || envText.match(/^DATABASE_URL=(.*)$/m);
const sql = neon(match[1].trim().replace(/^"|"$/g, ''));

console.log('--- ledger rows (expect 0007/0015 absent) ---');
console.log(await sql`select version, name from schema_migrations where version in ('0007','0015') order by version`);

// Mirrors 0007's own UPDATE predicate exactly rather than approximating it.
console.log('--- 0007: rows its UPDATE would touch (rn > 1) ---');
console.log(await sql`
  with ranked as (
    select id, user_id,
           row_number() over (
             partition by user_id
             order by expires_at desc, issued_at desc
           ) as rn
    from licenses
    where status = 'active' and expires_at > now() and user_id is not null
  )
  select id, user_id from ranked where rn > 1
`);

// 0015 is four single-row updates. Each is a no-op iff the license row it targets
// already holds the tier the migration sets, or no row matches at all.
const targets = [
  ['alonzo (trial)', 'trial', sql`select l.id, l.tier from licenses l join users u on u.id = l.user_id
                                   where u.email ilike 'alonzo%' and l.status = 'active'
                                   order by l.expires_at desc limit 1`],
  ['sahil (team)',   'team',  sql`select l.id, l.tier from licenses l join users u on u.id = l.user_id
                                   where u.email = 'sahilsahu202@gmail.com' and l.status = 'active'
                                   order by l.expires_at desc limit 1`],
  ['Wwwsss (paid)',  'paid',  sql`select l.id, l.tier from licenses l join users u on u.id = l.user_id
                                   where (u.telegram_username = 'Wwwsss' or u.display_name = 'Wwwsss') and l.status = 'active'
                                   order by l.expires_at desc limit 1`],
  ['jaymob (deal)',  'deal',  sql`select l.id, l.tier from licenses l join users u on u.id = l.user_id
                                   where u.email = 'jaymob123@gmail.com' and l.status = 'active'
                                   order by l.expires_at desc limit 1`],
];

console.log('--- 0015: per-statement re-run effect ---');
let dirty = false;
for (const [label, want, q] of targets) {
  const rows = await q;
  if (rows.length === 0) {
    console.log(`${label}: NO MATCHING ROW -> update touches 0 rows`);
  } else if (rows[0].tier === want) {
    console.log(`${label}: already tier='${rows[0].tier}' -> update touches 0 rows (no value change)`);
  } else {
    dirty = true;
    console.log(`${label}: WOULD CHANGE tier '${rows[0].tier}' -> '${want}' on license ${rows[0].id}`);
  }
}

if (dirty) {
  console.log('\nDO NOT PASTE: re-running 0015 would overwrite a tier set since the last check.');
  process.exitCode = 1;
}
