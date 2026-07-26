import crypto from "crypto";

const TTL_MS = 5 * 60 * 1000;

function secret(): string {
  const s = process.env.INSTALLER_URL_SECRET ?? process.env.AUTH_SECRET;
  if (!s) throw new Error("INSTALLER_URL_SECRET (or AUTH_SECRET) not configured");
  return s;
}

function sign(userId: string, resourceId: string, expires: number): string {
  return crypto.createHmac("sha256", secret()).update(`${userId}.${resourceId}.${expires}`).digest("base64url");
}

/** Short-lived signed download link scoped to one user + one download row — the raw Blob URL/token is never sent to the browser (see /api/download/file). */
export function signDownloadToken(userId: string, resourceId: string): { token: string; expires: number } {
  const expires = Date.now() + TTL_MS;
  return { token: sign(userId, resourceId, expires), expires };
}

export function verifyDownloadToken(userId: string, resourceId: string, expires: number, token: string): boolean {
  if (Date.now() > expires) return false;
  const expected = Buffer.from(sign(userId, resourceId, expires));
  const actual = Buffer.from(token);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}
