/**
 * The consult_services.slug shape. ONE source for 0105's CHECK (consult_services_slug_check) and
 * the S5 login-callback twin (Fable m65602 A1(a)): a slug read back from the DB is only safe to
 * build a redirect path from because the DB refused anything else. consult-0105.test.ts pins the
 * migration's CHECK to these literals, so changing one without the other fails the suite.
 *
 * Lowercase a-z0-9 with single hyphens, no leading/trailing hyphen: no '/', '.', '%' or ':' can
 * appear. 'ask' and 'apply' are the static pages under /marketplace/consulting and /consult.
 */
export const CONSULT_SLUG_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$";
export const CONSULT_SLUG_MAX = 64;
export const CONSULT_SLUG_RESERVED: readonly string[] = ["ask", "apply"];

const SLUG_RE = new RegExp(CONSULT_SLUG_PATTERN);

export function isConsultSlug(slug: string): boolean {
  return slug.length <= CONSULT_SLUG_MAX && SLUG_RE.test(slug) && !CONSULT_SLUG_RESERVED.includes(slug);
}
