import { pool } from "./db";
import { resolveGeoIp } from "./geoip";
import { notifyServerRegistered, notifyIpMismatch, notifyCountryChange } from "./telemetry-sink";
import { FEED_TYPE_META, getActiveLicensesForUser, type FeedType } from "./licenses";
import { SERVER_LOCATION_LABELS, type ServerLocation } from "./server-locations";

function isFeedType(value: string): value is FeedType {
  return (["futures", "london", "ny", "crypto"] as const).includes(value as FeedType);
}

function feedLabels(feedTypes: string[] | null | undefined): string[] {
  return (feedTypes ?? []).filter(isFeedType).map((ft) => FEED_TYPE_META[ft].name);
}

export const VPS_PROVIDERS = ["Beeks", "Contabo", "UltraFX Cloud", "personal", "other"] as const;
export type VpsProvider = (typeof VPS_PROVIDERS)[number];

export interface ServerRegistration {
  /** The server row's own primary key (0031). This is the stable identity of a *server*;
   * licenseId is an attribute of it, and under 0086 becomes nullable. Every by-id write
   * below keys on this, never on licenseId. */
  id: string;
  licenseId: string;
  serverName: string;
  vpsProvider: string;
  vpsProviderOther: string | null;
  serverLocation: string;
  /** Canonical grouping key -- null on legacy rows and whenever migration 0072 hasn't
   * landed on this DB yet (column simply absent from the row). Use
   * effectiveServerLocation() to resolve a group, never this field directly. */
  location: string | null;
  declaredIp: string;
  multipleIpsOk: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServerRegistrationInput {
  serverName: string;
  vpsProvider: string;
  vpsProviderOther: string | null;
  location: ServerLocation;
  declaredIp: string;
}

interface RegistrationRow {
  id: string;
  license_id: string;
  server_name: string;
  vps_provider: string;
  vps_provider_other: string | null;
  server_location: string;
  location?: string | null;
  declared_ip: string;
  multiple_ips_ok: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapRegistration(row: RegistrationRow): ServerRegistration {
  return {
    id: row.id,
    licenseId: row.license_id,
    serverName: row.server_name,
    vpsProvider: row.vps_provider,
    vpsProviderOther: row.vps_provider_other,
    serverLocation: row.server_location,
    location: row.location ?? null,
    declaredIp: row.declared_ip,
    multipleIpsOk: row.multiple_ips_ok,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Cached for the life of the process -- migrations are rare and a cold start re-checks
 * anyway, so this is the same "check once" cost as any other schema-shape assumption in
 * this file. Lets writes degrade to the pre-0072 column list instead of erroring with
 * 42703 undefined_column when the branch is merged/deployed ahead of the migration
 * being applied (main auto-deploys; migrations are a separate manual step here). */
let locationColumnExists: Promise<boolean> | null = null;
function checkLocationColumnExists(): Promise<boolean> {
  if (!locationColumnExists) {
    locationColumnExists = pool
      .query<{ exists: boolean }>(
        `select exists (
           select 1 from information_schema.columns
           where table_name = 'server_registrations' and column_name = 'location'
         ) as exists`
      )
      .then((r) => r.rows[0]?.exists ?? false)
      .catch(() => false);
  }
  return locationColumnExists;
}

export async function getServerRegistration(licenseId: string): Promise<ServerRegistration | null> {
  const result = await pool.query<RegistrationRow>(
    "select * from server_registrations where license_id = $1",
    [licenseId]
  );
  return result.rowCount ? mapRegistration(result.rows[0]) : null;
}

/** By-id counterpart of getServerRegistration. The licence-keyed reader above only works
 * while license_id is NOT NULL and unique; this one reads a server by its own identity and
 * keeps working after the 0086 tighten. No owner filter -- it is a plain reader, and every
 * caller that acts on the result must itself scope the write (see
 * updateServerRegistrationById). */
export async function getServerRegistrationById(id: string): Promise<ServerRegistration | null> {
  const result = await pool.query<RegistrationRow>(
    "select * from server_registrations where id = $1",
    [id]
  );
  return result.rowCount ? mapRegistration(result.rows[0]) : null;
}

/** First registered server across a user's active licenses, in the same expires_at-desc,
 * issued_at-desc order as getActiveLicensesForUser -- for single-registration banners
 * (/feeds, tiers page) that must agree with /account/servers on whether *any* active
 * license has a server registered, not just the single latest-issued one from
 * getLatestIssuedLicenseForUser (marcus, multi-license-visibility-2026-08-31 contradiction 1: the
 * old latest-issued-only check could tell a client with a registered server on an older
 * active license that no server was registered at all). Sequential rather than
 * Promise.all so the common single-license case costs exactly one query, same as before. */
export async function getAnyServerRegistrationForUser(userId: string): Promise<ServerRegistration | null> {
  const licenses = await getActiveLicensesForUser(userId);
  for (const license of licenses) {
    const registration = await getServerRegistration(license.id);
    if (registration) return registration;
  }
  return null;
}

/** Every registered server across a user's active licenses -- for the feed tier request
 * modal (feeds/[region]/tiers), which under the cross-region ruling (coxwell,
 * leo-cross-region-server-picker-2026-09-04: "yes they can if they wish") must offer a
 * picker over ALL of a client's servers, not just the one in the tier's own region.
 * Supersedes the old getServerRegistrationForUserInRegion, which silently hid
 * out-of-region servers and picked one for the user when more than one matched. */
export async function getServerRegistrationsForUser(userId: string): Promise<ServerRegistration[]> {
  const licenses = await getActiveLicensesForUser(userId);
  const registrations = await Promise.all(licenses.map((license) => getServerRegistration(license.id)));
  return registrations.filter((r): r is ServerRegistration => r != null);
}

/** Servers registered across every currently-active license a user holds — same
 * active-license criteria as computeUserActiveFeeds, so a two-license account can
 * legitimately show 2 (one registration per license, enforced by the license_id
 * unique constraint on server_registrations). */
export async function countUserActiveServers(userId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select count(*) from server_registrations sr
     join licenses l on l.id = sr.license_id
     where l.user_id = $1 and l.status = 'active' and l.expires_at > now()`,
    [userId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Upserts the registration and fires the "new registration" alert only on first insert
 * (an edit shouldn't re-fire it). adminUrl is passed in by the caller since this lib has
 * no request context to build one from.
 *
 * userId is the signed-in user, and under 0086 it must also be the licence owner -- the
 * only caller reaches here through requireLicenseId, which accepts licenseId only if it
 * appears in getActiveLicensesForUser(session.user.id) (licenses.ts:589, `where user_id =
 * $1`), so the two cannot diverge at this call site. Taking it from the session rather
 * than re-reading licenses.user_id is deliberate: 0086 keys this table on the server, not
 * the licence (license_id is already nullable and loses its NOT NULL/owner role in the
 * tighten), so the owner has to come from somewhere that survives license_id.
 *
 * Writing it is required, not optional, while 0086 is applied but the tighten is not:
 * ledger v1.49 Ruling 1(ii) -- "every server_registrations writer writes user_id" -- and
 * the tighten re-runs the section 1 backfill only as a safety net for rows written between
 * apply and this deploy. No information_schema guard like checkLocationColumnExists()
 * below: 0072 shipped code ahead of the migration, whereas 0086 was applied in prod
 * (2026-09-12 17:30Z) before this code existed, so the column is always there. If some
 * other DB lags 0086 the write should fail loudly with 42703 rather than silently leave
 * user_id NULL, which is exactly what the window rule forbids. */
export async function saveServerRegistration(
  licenseId: string,
  userId: string,
  input: ServerRegistrationInput,
  adminUrl: string,
  ownerEmail: string | null
): Promise<void> {
  // server_location keeps holding the human label so every existing reader (admin
  // panel, notification templates) is unaffected by the new fixed-select location.
  const serverLocationLabel = SERVER_LOCATION_LABELS[input.location];
  const hasLocationColumn = await checkLocationColumnExists();

  const result = hasLocationColumn
    ? await pool.query(
        `insert into server_registrations
           (license_id, user_id, server_name, vps_provider, vps_provider_other, server_location, location, declared_ip, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now())
         on conflict (license_id) do update set
           user_id = excluded.user_id,
           server_name = excluded.server_name,
           vps_provider = excluded.vps_provider,
           vps_provider_other = excluded.vps_provider_other,
           server_location = excluded.server_location,
           location = excluded.location,
           declared_ip = excluded.declared_ip,
           updated_at = now()
         returning (xmax = 0) as inserted`,
        [licenseId, userId, input.serverName, input.vpsProvider, input.vpsProviderOther, serverLocationLabel, input.location, input.declaredIp]
      )
    : await pool.query(
        `insert into server_registrations
           (license_id, user_id, server_name, vps_provider, vps_provider_other, server_location, declared_ip, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, now())
         on conflict (license_id) do update set
           user_id = excluded.user_id,
           server_name = excluded.server_name,
           vps_provider = excluded.vps_provider,
           vps_provider_other = excluded.vps_provider_other,
           server_location = excluded.server_location,
           declared_ip = excluded.declared_ip,
           updated_at = now()
         returning (xmax = 0) as inserted`,
        [licenseId, userId, input.serverName, input.vpsProvider, input.vpsProviderOther, serverLocationLabel, input.declaredIp]
      );

  if (result.rows[0]?.inserted) {
    const license = await pool.query<{ feed_types: string[] }>(
      `select feed_types from licenses where id = $1`,
      [licenseId]
    );
    await notifyServerRegistered({
      email: ownerEmail,
      serverName: input.serverName,
      vpsProvider: input.vpsProviderOther ? `${input.vpsProvider} (${input.vpsProviderOther})` : input.vpsProvider,
      declaredIp: input.declaredIp,
      declaredLocation: serverLocationLabel,
      feeds: feedLabels(license.rows[0]?.feed_types),
      adminUrl,
    }).catch(() => {});
  }
}

/** Edits an EXISTING server row by its own id. Split out of saveServerRegistration rather
 * than folded into it: that function's upsert is keyed on `on conflict (license_id)` and
 * stays exactly as it is (it is still the only insert path, and it still writes license_id
 * and user_id on every insert). This is the edit path, and it touches neither license_id
 * nor user_id -- an edit can never NULL the licence or move the row to another owner.
 *
 * The `and user_id = $2` clause is load-bearing, not defensive. Before the re-key the
 * ownership check WAS the licence key: actions.ts's requireLicenseId only accepted a
 * licenseId that appeared in the caller's own active licences, and the UPDATE then keyed on
 * that same licenseId. Keyed on a row id instead, `where id = $1` alone would let any
 * signed-in user edit any server row whose uuid they hold, so the owner clause has to carry
 * the check the licence key used to carry (Fable, ledger v1.61 condition (c)). Sound today
 * because 0086 backfilled user_id (no NULLs) and every insert has written it since ad0e10f.
 *
 * Returns false when nothing matched -- wrong id, or the row is not this user's. The caller
 * cannot tell those apart, which is deliberate.
 *
 * No notifyServerRegistered here: that alert fires on first insert only (xmax = 0), and an
 * edit never fired it before this split either. */
export async function updateServerRegistrationById(
  id: string,
  userId: string,
  input: ServerRegistrationInput
): Promise<boolean> {
  const serverLocationLabel = SERVER_LOCATION_LABELS[input.location];
  const hasLocationColumn = await checkLocationColumnExists();

  const result = hasLocationColumn
    ? await pool.query(
        `update server_registrations set
           server_name = $3,
           vps_provider = $4,
           vps_provider_other = $5,
           server_location = $6,
           location = $7,
           declared_ip = $8,
           updated_at = now()
         where id = $1 and user_id = $2`,
        [id, userId, input.serverName, input.vpsProvider, input.vpsProviderOther, serverLocationLabel, input.location, input.declaredIp]
      )
    : await pool.query(
        `update server_registrations set
           server_name = $3,
           vps_provider = $4,
           vps_provider_other = $5,
           server_location = $6,
           declared_ip = $7,
           updated_at = now()
         where id = $1 and user_id = $2`,
        [id, userId, input.serverName, input.vpsProvider, input.vpsProviderOther, serverLocationLabel, input.declaredIp]
      );

  return (result.rowCount ?? 0) > 0;
}

/** Most recent observed IP for a license, or null if the client has never connected.
 * Used client-side to distinguish Registered (nothing observed) from Verified (declared
 * IP matches what we see) — the third state, mismatch, is admin-only and never
 * computed for this surface. */
export async function getLatestConnectionIp(licenseId: string): Promise<string | null> {
  const result = await pool.query<{ ip: string }>(
    "select ip from connection_ips where license_id = $1 order by captured_at desc limit 1",
    [licenseId]
  );
  return result.rows[0]?.ip ?? null;
}

/** Admin-only flag, keyed on the server row's id. No owner clause on purpose: the caller
 * (admin/connections/actions.ts) gates on isAdminUser, and an admin acting on someone
 * else's server is the whole point of the surface (Fable, ledger v1.61 condition (c)).
 * Returns false when no row matched, so a click on a licence with no registered server
 * reports that instead of a silent success. */
export async function setMultipleIpsOk(registrationId: string, value: boolean): Promise<boolean> {
  const result = await pool.query(
    "update server_registrations set multiple_ips_ok = $2, updated_at = now() where id = $1",
    [registrationId, value]
  );
  return (result.rowCount ?? 0) > 0;
}

interface ConnectionRow {
  ip: string;
  captured_at: Date;
}

/** Dedupes against the most recent capture for this license — every desktop-client call
 * hitting this on an unchanged IP would otherwise flood connection_ips for no signal. A
 * row only lands when the IP actually changed, which is also the trigger point for the
 * mismatch/country-change alerts below — with one extra guard on the mismatch alert for
 * source "heartbeat", see inline. Fire-and-forget from route handlers. */
export async function captureConnectionIp(
  licenseId: string,
  ip: string,
  source: string,
  adminUrl: string
): Promise<void> {
  if (!ip || ip === "unknown") return;

  const last = await pool.query<ConnectionRow>(
    `select ip, captured_at from connection_ips where license_id = $1 order by captured_at desc limit 1`,
    [licenseId]
  );
  const previous = last.rows[0] ?? null;
  if (previous && previous.ip === ip) return; // unchanged, nothing to log or alert on

  // /v1/hb beats every 180s per open tab, so a client on a flapping address (mobile,
  // residential DHCP, rotating VPS egress) hops A->B->A->B all day and would re-fire the
  // mismatch alert on every hop. Window that ALERT at one per (license, ip) per 24h, for
  // source "heartbeat" only — the /v1/validate path is one-shot and is left untouched.
  // The connection_ips row below is still written on every change, so the capture log and
  // the admin history keep full fidelity; only the notification is suppressed.
  //
  // The window is read off connection_ips itself rather than a new alert-log table
  // (marcus's ruling: cheapest form, and 0085 is already queued for coxwell). That makes
  // it a proxy — it suppresses when this pair was last SEEN by a heartbeat inside 24h, not
  // when it was last ALERTED on. The two diverge only if the earlier sighting couldn't
  // alert (no registration, multiple_ips_ok set, or no declared IP at the time), in which
  // case a first alert can be delayed by up to 24h. Read BEFORE the insert below, so this
  // beat's own row can't suppress this beat's own alert.
  let mismatchAlertWindowed = false;
  if (source === "heartbeat") {
    const recent = await pool.query<{ one: number }>(
      `select 1 as one from connection_ips
        where license_id = $1 and ip = $2 and source = 'heartbeat'
          and captured_at > now() - interval '24 hours'
        limit 1`,
      [licenseId, ip]
    );
    mismatchAlertWindowed = recent.rows.length > 0;
  }

  await pool.query(
    `insert into connection_ips (license_id, ip, source) values ($1, $2, $3)`,
    [licenseId, ip, source]
  );

  const [registration, geo, prevGeo, owner] = await Promise.all([
    getServerRegistration(licenseId),
    resolveGeoIp(ip),
    previous ? resolveGeoIp(previous.ip) : Promise.resolve(null),
    pool.query<{ email: string | null; feed_types: string[] }>(
      `select u.email, l.feed_types from licenses l join users u on u.id = l.user_id where l.id = $1`,
      [licenseId]
    ),
  ]);
  const ownerEmail = owner.rows[0]?.email ?? null;
  const feeds = feedLabels(owner.rows[0]?.feed_types);
  if (!registration || registration.multipleIpsOk) return;

  if (registration.declaredIp && registration.declaredIp !== ip && !mismatchAlertWindowed) {
    await notifyIpMismatch({
      email: ownerEmail,
      serverName: registration.serverName,
      declaredIp: registration.declaredIp,
      actualIp: ip,
      actualLocation: geo ? [geo.city, geo.country].filter(Boolean).join(", ") || null : null,
      feeds,
      adminUrl,
    }).catch(() => {});
  }

  if (prevGeo?.country && geo?.country && prevGeo.country !== geo.country) {
    await notifyCountryChange({
      email: ownerEmail,
      serverName: registration.serverName,
      fromCountry: prevGeo.country,
      toCountry: geo.country,
      newIp: ip,
      feeds,
      adminUrl,
    }).catch(() => {});
  }
}

export interface ConnectionHistoryEntry {
  ip: string;
  capturedAt: Date;
  country: string | null;
  city: string | null;
  isp: string | null;
}

export async function getConnectionHistory(licenseId: string, limit = 10): Promise<ConnectionHistoryEntry[]> {
  const result = await pool.query<{ ip: string; captured_at: Date }>(
    `select ip, captured_at from connection_ips where license_id = $1 order by captured_at desc limit $2`,
    [licenseId, limit]
  );
  return Promise.all(
    result.rows.map(async (row) => {
      const geo = await resolveGeoIp(row.ip);
      return {
        ip: row.ip,
        capturedAt: row.captured_at,
        country: geo?.country ?? null,
        city: geo?.city ?? null,
        isp: geo?.isp ?? null,
      };
    })
  );
}

export interface ConnectionOverviewRow {
  /** The server row's id, or null for the union's second arm (a licence with connection
   * history but no registered server). This, not licenseId, is what identifies a row
   * once license_id is nullable -- two licence-less servers would otherwise be
   * indistinguishable. */
  registrationId: string | null;
  licenseId: string | null;
  userId: string | null;
  email: string | null;
  serverName: string | null;
  vpsProvider: string | null;
  declaredIp: string | null;
  declaredLocation: string | null;
  multipleIpsOk: boolean;
  latestIp: string | null;
  latestCapturedAt: Date | null;
  latestCountry: string | null;
  latestCity: string | null;
  latestIsp: string | null;
  mismatch: boolean;
  feeds: string[];
}

/** /admin/connections source of truth — one row per REGISTERED SERVER, plus one row per
 * licence that has captured connections but no server row, newest capture first.
 *
 * The key set used to be `select license_id from server_registrations union select
 * license_id from latest`. Once 0086's tighten makes server_registrations.license_id
 * nullable that unions a NULL into the key set, and every join below is on that key, so
 * `sr.license_id = li.license_id` is never true for it: the licence-less server would
 * collapse to a single all-NULL phantom row (SQL `union` folds every NULL into one) and
 * the servers themselves would vanish from the admin's only view of them.
 *
 * So the first arm is now keyed on the server's own id and the second arm is stated
 * explicitly as "licences with history and no server row" rather than being deduped into
 * shape by `union`. On today's data the two are the same set of rows: license_id is still
 * NOT NULL and still unique on server_registrations, so one key per server row is one key
 * per license_id, and `not exists` removes exactly what `union` deduped. connection_ips
 * .license_id is NOT NULL with an FK (0031), so the second arm cannot contribute a NULL
 * either. Ordering expression is untouched; ties between equal timestamps were already
 * unordered and still are. */
export async function listConnectionOverview(): Promise<ConnectionOverviewRow[]> {
  const result = await pool.query<{
    registration_id: string | null;
    license_id: string | null;
    user_id: string | null;
    email: string | null;
    server_name: string | null;
    vps_provider: string | null;
    declared_ip: string | null;
    server_location: string | null;
    multiple_ips_ok: boolean | null;
    latest_ip: string | null;
    latest_captured_at: Date | null;
    feed_types: string[] | null;
  }>(
    `with latest as (
       select distinct on (license_id) license_id, ip, captured_at
       from connection_ips
       order by license_id, captured_at desc
     ),
     keys as (
       -- one key per registered server, by its own id; its license_id rides along as an
       -- attribute and may be null once the tighten lands
       select sr.id as registration_id, sr.license_id
       from server_registrations sr
       union all
       -- licences with connection history but no server row of their own
       select null::uuid as registration_id, latest.license_id
       from latest
       where not exists (
         select 1 from server_registrations sr2 where sr2.license_id = latest.license_id
       )
     )
     select
       k.registration_id,
       k.license_id,
       u.id as user_id,
       u.email,
       sr.server_name,
       sr.vps_provider,
       sr.declared_ip,
       sr.server_location,
       sr.multiple_ips_ok,
       latest.ip as latest_ip,
       latest.captured_at as latest_captured_at,
       l.feed_types
     from keys k
     left join server_registrations sr on sr.id = k.registration_id
     left join latest on latest.license_id = k.license_id
     left join licenses l on l.id = k.license_id
     left join users u on u.id = l.user_id
     order by coalesce(latest.captured_at, sr.updated_at) desc nulls last`
  );

  return Promise.all(
    result.rows.map(async (row) => {
      const geo = row.latest_ip ? await resolveGeoIp(row.latest_ip) : null;
      const mismatch = !!(
        row.declared_ip &&
        row.latest_ip &&
        row.declared_ip !== row.latest_ip &&
        !row.multiple_ips_ok
      );
      return {
        registrationId: row.registration_id,
        licenseId: row.license_id,
        userId: row.user_id,
        email: row.email,
        serverName: row.server_name,
        vpsProvider: row.vps_provider,
        declaredIp: row.declared_ip,
        declaredLocation: row.server_location,
        multipleIpsOk: row.multiple_ips_ok ?? false,
        latestIp: row.latest_ip,
        latestCapturedAt: row.latest_captured_at,
        latestCountry: geo?.country ?? null,
        latestCity: geo?.city ?? null,
        latestIsp: geo?.isp ?? null,
        mismatch,
        feeds: feedLabels(row.feed_types),
      };
    })
  );
}
