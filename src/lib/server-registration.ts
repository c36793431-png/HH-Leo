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
 * no request context to build one from. */
export async function saveServerRegistration(
  licenseId: string,
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
           (license_id, server_name, vps_provider, vps_provider_other, server_location, location, declared_ip, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, now())
         on conflict (license_id) do update set
           server_name = excluded.server_name,
           vps_provider = excluded.vps_provider,
           vps_provider_other = excluded.vps_provider_other,
           server_location = excluded.server_location,
           location = excluded.location,
           declared_ip = excluded.declared_ip,
           updated_at = now()
         returning (xmax = 0) as inserted`,
        [licenseId, input.serverName, input.vpsProvider, input.vpsProviderOther, serverLocationLabel, input.location, input.declaredIp]
      )
    : await pool.query(
        `insert into server_registrations
           (license_id, server_name, vps_provider, vps_provider_other, server_location, declared_ip, updated_at)
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (license_id) do update set
           server_name = excluded.server_name,
           vps_provider = excluded.vps_provider,
           vps_provider_other = excluded.vps_provider_other,
           server_location = excluded.server_location,
           declared_ip = excluded.declared_ip,
           updated_at = now()
         returning (xmax = 0) as inserted`,
        [licenseId, input.serverName, input.vpsProvider, input.vpsProviderOther, serverLocationLabel, input.declaredIp]
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

export async function setMultipleIpsOk(licenseId: string, value: boolean): Promise<void> {
  await pool.query(
    "update server_registrations set multiple_ips_ok = $2, updated_at = now() where license_id = $1",
    [licenseId, value]
  );
}

interface ConnectionRow {
  ip: string;
  captured_at: Date;
}

/** Dedupes against the most recent capture for this license — every desktop-client call
 * hitting this on an unchanged IP would otherwise flood connection_ips for no signal. A
 * row only lands when the IP actually changed, which is also exactly the trigger point
 * for the mismatch/country-change alerts below. Fire-and-forget from route handlers. */
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

  if (registration.declaredIp && registration.declaredIp !== ip) {
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
  licenseId: string;
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

/** /admin/connections source of truth — one row per license that has EITHER a
 * registration or at least one captured connection, newest capture first. */
export async function listConnectionOverview(): Promise<ConnectionOverviewRow[]> {
  const result = await pool.query<{
    license_id: string;
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
     license_ids as (
       select license_id from server_registrations
       union
       select license_id from latest
     )
     select
       li.license_id,
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
     from license_ids li
     left join server_registrations sr on sr.license_id = li.license_id
     left join latest on latest.license_id = li.license_id
     left join licenses l on l.id = li.license_id
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
