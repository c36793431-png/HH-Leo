import { pool } from "./db";
import { clientRefForUser } from "./client-ref";
import { notifyProviderRequest } from "./telemetry-sink";
import { PORTAL_ORIGIN } from "./feed-host-admin";
import { assertPublicFields } from "./consult-public-text";
import { CONSULT_PROFILE_PATH, getListedProfileRef } from "./consultant-profiles";

/**
 * Consult S4: a signed-in client asks ONE listed service provider for help (marcus m71393, 0116 provider_profile_id).
 * Stored in consult_requests as kind 'request' with provider_profile_id set at create (routed_to_user_id keeps its
 * 0105 meaning, "accepted by"). One OPEN (pending/accepted) request per client per provider: 0116's partial unique
 * index, refused here in words. The provider must still pass the listing gate at the moment of the request. The
 * message goes through the public-text filter, so no contact details or prices travel in it. In v1 the provider
 * sees nothing: admins get a card and relay it from /admin/provider-requests.
 */

export const PROVIDER_REQUESTS_ADMIN_URL = `${PORTAL_ORIGIN}/admin/provider-requests`;
export const PROVIDER_REQUEST_LIMITS = { message: 2000, telegramMin: 2, telegram: 64 } as const;

export class ProviderRequestError extends Error {}

export interface ProviderRequestInput {
  message: string;
  telegramHandle: string | null;
}

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** The request form: a message (1..2000, no prices or contact details) and, only when the account has no Telegram on
 * file, an optional handle (0105's telegram_handle rule; never written back to users). */
export function parseProviderRequest(formData: FormData): ProviderRequestInput {
  const L = PROVIDER_REQUEST_LIMITS;
  const message = field(formData, "message");
  const telegramHandle = field(formData, "telegram") || null;
  if (!message || message.length > L.message) throw new ProviderRequestError(`Tell the provider what you need, up to ${L.message} characters`);
  if (telegramHandle && (telegramHandle.length < L.telegramMin || telegramHandle.length > L.telegram)) {
    throw new ProviderRequestError(`Telegram must be ${L.telegramMin} to ${L.telegram} characters`);
  }
  assertPublicFields([["Message", message]], (m) => new ProviderRequestError(m), "Horizon passes your request on.");
  return { message, telegramHandle };
}

const PG_UNIQUE_VIOLATION = "23505";

export async function createProviderRequest(clientUserId: string, slug: string, input: ProviderRequestInput): Promise<{ id: string }> {
  const profile = await getListedProfileRef(slug);
  if (!profile) throw new ProviderRequestError("This provider is not listed");
  if (profile.userId === clientUserId) throw new ProviderRequestError("This is your own profile");

  const account = await pool.query(`select telegram_username, telegram_user_id from users where id = $1`, [clientUserId]);
  if (!account.rows[0]) throw new ProviderRequestError("Sign in again to send a request");
  const hasTelegram = account.rows[0].telegram_username != null || account.rows[0].telegram_user_id != null;
  const telegramHandle = hasTelegram ? null : input.telegramHandle;

  let id: string;
  try {
    const r = await pool.query(
      `insert into consult_requests (user_id, kind, body, telegram_handle, provider_profile_id)
       values ($1, 'request', $2, $3, $4) returning id`,
      [clientUserId, input.message, telegramHandle, profile.id]
    );
    id = r.rows[0].id;
  } catch (err) {
    if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      throw new ProviderRequestError("You already have an open request with this provider; we will be in touch");
    }
    throw err;
  }

  const client = await clientRefForUser(clientUserId);
  await notifyProviderRequest({
    client,
    providerName: profile.displayName,
    providerPath: `${CONSULT_PROFILE_PATH}/${profile.slug}`,
    message: input.message,
    telegramHandle,
    adminUrl: PROVIDER_REQUESTS_ADMIN_URL,
  }).catch(() => {});
  return { id };
}

export interface ProviderRequestAdminRow {
  id: string;
  createdAt: Date;
  status: string;
  message: string;
  telegramHandle: string | null;
  clientEmail: string | null;
  clientTelegram: string | null;
  providerName: string;
  providerSlug: string;
}

/** The admin list (admins relay requests in v1). Newest first. */
export async function listProviderRequestsForAdmin(): Promise<ProviderRequestAdminRow[]> {
  const r = await pool.query(
    `select r.id, r.created_at, r.status, r.body, r.telegram_handle, u.email as client_email, u.telegram_username as client_telegram,
            p.display_name, p.slug
     from consult_requests r
     join consultant_profiles p on p.id = r.provider_profile_id
     join users u on u.id = r.user_id
     order by r.created_at desc, r.id`
  );
  return r.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    message: row.body ?? "",
    telegramHandle: row.telegram_handle ?? null,
    clientEmail: row.client_email ?? null,
    clientTelegram: row.client_telegram ?? null,
    providerName: row.display_name,
    providerSlug: row.slug,
  }));
}
