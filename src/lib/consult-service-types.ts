/**
 * What a service provider offers (coxwell via marcus m71305: "consulting, services, coding etc general"). ONE list for
 * the application form, the profile and the marketplace filter, and the literal list in 0116's CHECKs
 * (consultant_applications_service_types_check, consultant_profiles_service_types_check); consult-s3-0116.test.ts pins
 * the two together, so changing one without the other fails the suite. 'other' carries a free-text name.
 */
export const CONSULT_SERVICE_TYPES = ["consulting", "coding", "setup", "other"] as const;
export type ConsultServiceType = (typeof CONSULT_SERVICE_TYPES)[number];

export const CONSULT_SERVICE_TYPE_LABELS: Record<ConsultServiceType, string> = {
  consulting: "Consulting",
  coding: "Coding / development",
  setup: "Setup / installation",
  other: "Other",
};

/** The 0116 limit on service_other. */
export const CONSULT_SERVICE_OTHER_MAX = 200;

export function isConsultServiceType(value: string): value is ConsultServiceType {
  return (CONSULT_SERVICE_TYPES as readonly string[]).includes(value);
}

export class ConsultServiceTypesError extends Error {}

/**
 * The form's checkboxes ("serviceTypes", repeated) and the "serviceOther" text, checked against 0116: at least one
 * type, every one from the list, no repeats; the other-name exactly when Other is ticked. Returned in list order.
 * Throws ConsultServiceTypesError with the message the provider sees.
 */
export function parseConsultServiceTypes(formData: FormData): { serviceTypes: ConsultServiceType[]; serviceOther: string | null } {
  const raw = formData.getAll("serviceTypes").map((v) => (typeof v === "string" ? v.trim() : ""));
  if (raw.length === 0) throw new ConsultServiceTypesError("Choose at least one service you offer");
  for (const v of raw) {
    if (!isConsultServiceType(v)) throw new ConsultServiceTypesError("Choose services from the list");
  }
  const serviceTypes = CONSULT_SERVICE_TYPES.filter((t) => raw.includes(t));
  const otherRaw = formData.get("serviceOther");
  const other = typeof otherRaw === "string" ? otherRaw.trim() : "";
  if (serviceTypes.includes("other")) {
    if (!other || other.length > CONSULT_SERVICE_OTHER_MAX) {
      throw new ConsultServiceTypesError(`Name the other service, up to ${CONSULT_SERVICE_OTHER_MAX} characters`);
    }
    return { serviceTypes, serviceOther: other };
  }
  return { serviceTypes, serviceOther: null };
}

/** The marketplace's ?type= filter: a known type, or null (no filter) for anything else, never an error. */
export function serviceTypeFilter(value: string | string[] | undefined): ConsultServiceType | null {
  return typeof value === "string" && isConsultServiceType(value) ? value : null;
}
