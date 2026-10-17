import { pool } from "./db";
import { resolveAdminUserId } from "./admin";
import { resolveConsultantAccount } from "./consultant-applications";
import { isConsultSlug } from "./consult-slug";
import { parseConsultServiceTypes, ConsultServiceTypesError, type ConsultServiceType } from "./consult-service-types";
import { assertPublicFields } from "./consult-public-text";
import { notifyConsultantProfileShown } from "./telemetry-sink";
import { CONSULT_APPLICATIONS_ADMIN_URL } from "./consultant-applications";

/** The public profile path (marcus m71369 item 2): /marketplace/services/<slug>. */
export const CONSULT_PROFILE_PATH = "/marketplace/services";

/**
 * Consult S3: service-provider profiles (0116; marcus m71301 profiles in the marketplace, m71305 any service provider).
 *
 * A profile is the public face of ONE approved application, owned by the account that application is linked to
 * (resolveConsultantAccount, the verified-email link). The provider writes it and switches it on or off; admins can
 * hide it. It is LISTED only while the application is still approved AND the profile is published AND not hidden;
 * listListedProfiles and getListedProfile apply that one gate. Listings never carry the account's email or id.
 * No prices, no contact details: a client reaches a provider through a request (S4).
 */

export const CONSULTANT_PROFILE_LIMITS = { displayName: 80, headline: 120, about: 2000, freeText: 200 } as const;

export class ConsultantProfileError extends Error {}

export interface ConsultantProfileInput {
  slug: string;
  displayName: string;
  headline: string;
  about: string;
  serviceTypes: ConsultServiceType[];
  serviceOther: string | null;
  markets: string;
  platforms: string;
  languages: string;
}

/** What the provider sees and edits (their own row). */
export interface OwnConsultantProfile extends ConsultantProfileInput {
  id: string;
  published: boolean;
  adminHidden: boolean;
  updatedAt: Date;
}

/** What the marketplace shows: no email, no account id, no admin flag. */
export interface ListedConsultantProfile {
  slug: string;
  displayName: string;
  headline: string;
  about: string;
  serviceTypes: ConsultServiceType[];
  serviceOther: string | null;
  markets: string;
  platforms: string;
  languages: string;
}

/** A starting profile address from a name: lowercase a-z0-9 with single hyphens, cut to the slug limit; "provider" when
 * nothing usable is left or the result is reserved. Only a suggestion: the provider edits it and the save re-checks it. */
export function suggestConsultSlug(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return isConsultSlug(s) ? s : "provider";
}

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** The editor's fields, checked against the 0116 limits. Throws ConsultantProfileError with the message the provider
 * sees. The slug is stored lowercase and must be the consult-slug.ts shape. */
export function parseConsultantProfile(formData: FormData): ConsultantProfileInput {
  const L = CONSULTANT_PROFILE_LIMITS;
  const slug = field(formData, "slug").toLowerCase();
  const displayName = field(formData, "displayName");
  const headline = field(formData, "headline");
  const about = field(formData, "about");
  const markets = field(formData, "markets");
  const platforms = field(formData, "platforms");
  const languages = field(formData, "languages");

  if (!isConsultSlug(slug)) {
    throw new ConsultantProfileError("Profile address: lowercase letters, numbers and single hyphens, up to 64 characters");
  }
  if (!displayName || displayName.length > L.displayName) throw new ConsultantProfileError(`Name is required, up to ${L.displayName} characters`);
  if (!headline || headline.length > L.headline) throw new ConsultantProfileError(`Headline is required, up to ${L.headline} characters`);
  if (!about || about.length > L.about) throw new ConsultantProfileError(`About is required, up to ${L.about} characters`);
  for (const [label, v] of [["Markets", markets], ["Platforms", platforms], ["Languages", languages]] as const) {
    if (v.length > L.freeText) throw new ConsultantProfileError(`${label} is up to ${L.freeText} characters`);
  }
  let types: { serviceTypes: ConsultServiceType[]; serviceOther: string | null };
  try {
    types = parseConsultServiceTypes(formData);
  } catch (err) {
    if (err instanceof ConsultServiceTypesError) throw new ConsultantProfileError(err.message);
    throw err;
  }
  // Public the moment it is shown, with no review: no prices, no contact details (marcus m71369 1a, consult-public-text.ts).
  assertPublicFields(
    [["Name", displayName], ["Headline", headline], ["About", about], ["Markets", markets], ["Platforms", platforms], ["Languages", languages], ["Other service", types.serviceOther]],
    (message) => new ConsultantProfileError(message)
  );
  return { slug, displayName, headline, about, ...types, markets, platforms, languages };
}

const COLS = `id, slug, display_name, headline, about, service_types, service_other, markets, platforms, languages,
  published, admin_hidden, updated_at`;

function mapListed(row: Record<string, unknown>): ListedConsultantProfile {
  return {
    slug: row.slug as string,
    displayName: row.display_name as string,
    headline: row.headline as string,
    about: row.about as string,
    serviceTypes: row.service_types as ConsultServiceType[],
    serviceOther: (row.service_other as string | null) ?? null,
    markets: row.markets as string,
    platforms: row.platforms as string,
    languages: row.languages as string,
  };
}

function mapOwn(row: Record<string, unknown>): OwnConsultantProfile {
  return { ...mapListed(row), id: row.id as string, published: row.published as boolean, adminHidden: row.admin_hidden as boolean, updatedAt: row.updated_at as Date };
}

export async function getOwnConsultantProfile(userId: string): Promise<OwnConsultantProfile | null> {
  const r = await pool.query(`select ${COLS} from consultant_profiles where user_id = $1`, [userId]);
  return r.rows[0] ? mapOwn(r.rows[0]) : null;
}

const PG_UNIQUE_VIOLATION = "23505";

/**
 * Creates or updates the account's own profile. Only for the account's own APPROVED application, linked to it
 * (resolveConsultantAccount links an approved one by verified email first). Re-checked inside the transaction with the
 * application row locked, so a profile is never written against a row that is not approved and linked to this account.
 * Saving never changes `published`.
 */
export async function saveOwnConsultantProfile(userId: string, input: ConsultantProfileInput): Promise<OwnConsultantProfile> {
  const account = await resolveConsultantAccount(userId);
  if (account.state !== "approved") throw new ConsultantProfileError("Your profile opens once your application is approved");

  const client = await pool.connect();
  try {
    await client.query("begin");
    const app = await client.query(`select id from consultant_applications where id = $1 and user_id = $2 and status = 'approved' for update`, [account.applicationId, userId]);
    if (!app.rows[0]) throw new ConsultantProfileError("Your profile opens once your application is approved");
    const prev = await client.query(`select published from consultant_profiles where user_id = $1 for update`, [userId]);
    const wasShown = prev.rows[0]?.published === true;
    const values = [userId, account.applicationId, input.slug, input.displayName, input.headline, input.about, input.serviceTypes, input.serviceOther, input.markets, input.platforms, input.languages];
    const saved = await client.query(
      `insert into consultant_profiles (user_id, application_id, slug, display_name, headline, about, service_types, service_other, markets, platforms, languages)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (user_id) do update set
         slug = excluded.slug, display_name = excluded.display_name, headline = excluded.headline, about = excluded.about,
         service_types = excluded.service_types, service_other = excluded.service_other, markets = excluded.markets,
         platforms = excluded.platforms, languages = excluded.languages, updated_at = now()
       where consultant_profiles.application_id = excluded.application_id
       returning ${COLS}`,
      values
    );
    if (!saved.rows[0]) throw new ConsultantProfileError("This profile belongs to another application; contact support@horizonhft.com");
    await client.query("commit");
    const own = mapOwn(saved.rows[0]);
    // A shown profile changed with no review: tell the admins so it can be hidden fast (marcus m71369 1b). After the commit;
    // a Telegram failure never fails the save.
    if (wasShown) await notifyConsultantProfileShown({ event: "edited", name: own.displayName, path: `${CONSULT_PROFILE_PATH}/${own.slug}`, adminUrl: CONSULT_APPLICATIONS_ADMIN_URL }).catch(() => {});
    return own;
  } catch (err) {
    await client.query("rollback");
    if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) throw new ConsultantProfileError("That profile address is taken; choose another");
    throw err;
  } finally {
    client.release();
  }
}

/** The provider's own switch. Turning it ON needs the application still approved; OFF always works. Going from not shown
 * to shown tells the admins (marcus m71369 1b), after the commit; a Telegram failure never fails the switch. */
export async function setOwnConsultantProfilePublished(userId: string, published: boolean): Promise<void> {
  const client = await pool.connect();
  let shownNow: { name: string; slug: string } | null = null;
  try {
    await client.query("begin");
    const prev = await client.query(`select published from consultant_profiles where user_id = $1 for update`, [userId]);
    const r = await client.query(
      `update consultant_profiles p set published = $2, updated_at = now()
       where p.user_id = $1
         and ($2 = false or exists (
           select 1 from consultant_applications a where a.id = p.application_id and a.user_id = p.user_id and a.status = 'approved'))
       returning p.slug, p.display_name`,
      [userId, published]
    );
    if (!r.rows[0]) throw new ConsultantProfileError(published ? "Save your profile first; it can be shown once your application is approved" : "No profile to change");
    await client.query("commit");
    if (published && prev.rows[0]?.published === false) shownNow = { name: r.rows[0].display_name, slug: r.rows[0].slug };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  if (shownNow) await notifyConsultantProfileShown({ event: "shown", name: shownNow.name, path: `${CONSULT_PROFILE_PATH}/${shownNow.slug}`, adminUrl: CONSULT_APPLICATIONS_ADMIN_URL }).catch(() => {});
}

/** Admins take a profile down or put it back (one row, audited). The provider's own switch is untouched. */
export async function setConsultantProfileHidden(profileId: string, hidden: boolean, actionedBy: string): Promise<void> {
  const adminId = await resolveAdminUserId(actionedBy);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const r = await client.query(`update consultant_profiles set admin_hidden = $2 where id = $1 returning user_id, slug`, [profileId, hidden]);
    if (!r.rows[0]) throw new ConsultantProfileError("Profile not found");
    await client.query(
      `insert into admin_actions (admin_user_id, action_type, target_user_id, details_json) values ($1, $2, $3, $4)`,
      [adminId, hidden ? "consultant_profile_hidden" : "consultant_profile_unhidden", r.rows[0].user_id, JSON.stringify({ consultantProfileId: profileId, slug: r.rows[0].slug })]
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/** For the admin queue: every profile's state, keyed by application id. Admin-only page; carries no listing rule. */
export async function listConsultantProfilesForAdmin(): Promise<Map<string, { id: string; slug: string; published: boolean; adminHidden: boolean }>> {
  const r = await pool.query(`select id, application_id, slug, published, admin_hidden from consultant_profiles`);
  return new Map(r.rows.map((row) => [row.application_id as string, { id: row.id as string, slug: row.slug as string, published: row.published as boolean, adminHidden: row.admin_hidden as boolean }]));
}

/** The ONE marketplace gate: application approved and linked to the profile's account, published, not hidden. */
const LISTED = `
  from consultant_profiles p
  join consultant_applications a on a.id = p.application_id and a.user_id = p.user_id and a.status = 'approved'
  where p.published and not p.admin_hidden`;

/** Listed profiles, newest change first; with a type, only profiles offering it. */
export async function listListedConsultantProfiles(type: ConsultServiceType | null = null): Promise<ListedConsultantProfile[]> {
  const params: unknown[] = [];
  let and = "";
  if (type) {
    params.push(type);
    and = ` and $1 = any(p.service_types)`;
  }
  const r = await pool.query(`select p.${COLS.replace(/,\s*/g, ", p.")} ${LISTED}${and} order by p.updated_at desc, p.id`, params);
  return r.rows.map(mapListed);
}

export async function getListedConsultantProfile(slug: string): Promise<ListedConsultantProfile | null> {
  if (!isConsultSlug(slug)) return null;
  const r = await pool.query(`select p.${COLS.replace(/,\s*/g, ", p.")} ${LISTED} and p.slug = $1`, [slug]);
  return r.rows[0] ? mapListed(r.rows[0]) : null;
}
