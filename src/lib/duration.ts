export type DurationUnit = "minutes" | "hours" | "days" | "weeks" | "months";
export type DurationMode = "duration" | "absolute";
export type ExtendFrom = "now" | "current";

export interface DurationFormInput {
  mode: DurationMode;
  amount?: number;
  unit?: DurationUnit;
  absoluteExpiresAt?: string;
  extendFrom?: ExtendFrom;
}

export const DURATION_UNITS: DurationUnit[] = ["minutes", "hours", "days", "weeks", "months"];

export const DURATION_PRESETS: { label: string; amount: number; unit: DurationUnit }[] = [
  { label: "1h", amount: 1, unit: "hours" },
  { label: "24h", amount: 24, unit: "hours" },
  { label: "7d", amount: 7, unit: "days" },
  { label: "30d", amount: 30, unit: "days" },
  { label: "90d", amount: 90, unit: "days" },
  { label: "1y", amount: 12, unit: "months" },
];

const UNIT_MS: Record<DurationUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 7 * 86_400_000,
  months: 30 * 86_400_000,
};

export function parseDurationFormData(formData: FormData): DurationFormInput {
  const mode: DurationMode = formData.get("mode") === "absolute" ? "absolute" : "duration";
  const amountRaw = formData.get("amount");
  const unitRaw = formData.get("unit") as string | null;
  return {
    mode,
    amount: amountRaw ? Number(amountRaw) : undefined,
    unit: unitRaw && (DURATION_UNITS as string[]).includes(unitRaw) ? (unitRaw as DurationUnit) : undefined,
    absoluteExpiresAt: (formData.get("absoluteExpiresAt") as string | null) ?? undefined,
    extendFrom: formData.get("extendFrom") === "now" ? "now" : "current",
  };
}

/** Shared by issue + extend flows across /admin, /admin/users, and /admin/licenses. */
export function resolveExpiresAt(input: DurationFormInput, currentExpiresAt?: Date | null): Date {
  if (input.mode === "absolute") {
    if (!input.absoluteExpiresAt) throw new Error("Absolute expiry date is required");
    const d = new Date(input.absoluteExpiresAt);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid expiry date");
    if (d.getTime() <= Date.now()) throw new Error("Expiry must be in the future");
    return d;
  }

  if (!input.amount || input.amount <= 0 || !input.unit) {
    throw new Error("Duration amount and unit are required");
  }
  const base =
    input.extendFrom === "current" && currentExpiresAt && currentExpiresAt.getTime() > Date.now()
      ? currentExpiresAt
      : new Date();
  return new Date(base.getTime() + input.amount * UNIT_MS[input.unit]);
}
