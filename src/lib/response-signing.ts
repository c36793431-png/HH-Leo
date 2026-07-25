import crypto from "crypto";

/**
 * Response signing for the desktop-client endpoints (/v1/validate, /v1/hb).
 *
 * WHY ASYMMETRIC: the client must be able to verify a response *offline* (see
 * security finding #2 — the offline-grace path in Program.cs:102-104). If we used
 * an HMAC, the shared secret would have to ship inside the client binary — the exact
 * "creds in the binary" mistake we're eliminating. Instead the server holds an
 * Ed25519 *private* key (env: LICENSE_SIGNING_PRIVATE_KEY) and only the *public* key
 * is embedded in the client. A leaked client reveals nothing that lets an attacker
 * forge a response.
 *
 * FROZEN-CONTRACT NOTE: the exact envelope shape below (field name `sig`, base64url,
 * canonical-JSON-over-sorted-keys) is a *proposal* until the client side is written
 * to verify it. The client rebuild owner must implement verification against the same
 * canonicalization. Do not treat this as final until that lands. See followup list.
 */

/** Deterministic JSON: keys sorted at every level so the signed bytes are reproducible client-side. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortDeep((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return value;
}

function privateKey(): crypto.KeyObject | null {
  const pem = process.env.LICENSE_SIGNING_PRIVATE_KEY;
  if (!pem) return null; // Not configured (local dev): callers must decide whether to serve unsigned.
  // Support single-line env storage (\n escaped) as well as raw multiline PEM.
  const normalized = pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
  return crypto.createPrivateKey(normalized);
}

export interface SignedEnvelope<T> {
  data: T;
  /** base64url Ed25519 signature over canonicalize(data). */
  sig: string;
  /** Key id so the client can roll keys without a hard cutover. TODO: wire real kid. */
  kid: string;
}

/**
 * Wrap a payload in a signed envelope. Returns null when no signing key is configured
 * so the caller can choose to hard-fail (production) rather than serve unsigned.
 */
export function signResponse<T>(data: T): SignedEnvelope<T> | null {
  const key = privateKey();
  if (!key) return null;
  const message = Buffer.from(canonicalize(data), "utf8");
  // Ed25519: algorithm arg must be null (the key type selects the hash).
  const signature = crypto.sign(null, message, key);
  return {
    data,
    sig: signature.toString("base64url"),
    kid: process.env.LICENSE_SIGNING_KID ?? "k1",
  };
}

/** True once a signing key is present — production routes should refuse to serve without one. */
export function signingConfigured(): boolean {
  return !!process.env.LICENSE_SIGNING_PRIVATE_KEY;
}
