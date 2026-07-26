import type { LicenseDetail } from "@/lib/licenses";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";

const EXPIRING_SOON_MS = 24 * 60 * 60 * 1000;

const BADGE_STYLES = {
  green: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  amber: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  red: "border-red-500/40 bg-red-500/15 text-red-300",
  grey: "border-zinc-600/40 bg-zinc-600/15 text-zinc-400",
} as const;

function getBadge(license: LicenseDetail | null): { label: string; color: keyof typeof BADGE_STYLES } {
  if (!license) return { label: "NO LICENSE", color: "grey" };
  if (license.status === "revoked") return { label: "REVOKED", color: "red" };
  const msUntilExpiry = license.expiresAt.getTime() - Date.now();
  if (msUntilExpiry <= 0) return { label: "EXPIRED", color: "red" };
  if (msUntilExpiry < EXPIRING_SOON_MS) return { label: "EXPIRING SOON", color: "amber" };
  return { label: "ACTIVE", color: "green" };
}

export function LicenseStatusCard({
  license,
  telegramChannelUrl,
}: {
  license: LicenseDetail | null;
  telegramChannelUrl: string;
}) {
  const badge = getBadge(license);

  return (
    <section className="rounded-xl border border-cyan-500/60 bg-zinc-950/60 p-6 shadow-[0_0_20px_-6px_rgba(34,211,238,0.5)] sm:col-span-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-cyan-400">License status</h2>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${BADGE_STYLES[badge.color]}`}
        >
          {badge.label}
        </span>
      </div>

      {license ? (
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs text-zinc-500">License key</p>
            <p className={`mt-1 font-mono ${badge.color === "green" ? "text-emerald-300" : "text-red-400"}`}>
              {license.licenseKey}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Tier</p>
            <p className="mt-1 text-zinc-200">{license.tier}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Expires</p>
            <p className="mt-1 text-zinc-200">
              {formatAbsoluteUtc(license.expiresAt)}{" "}
              <span className="text-zinc-500">({formatRelative(license.expiresAt)})</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">HWID</p>
            <p className="mt-1 font-mono text-zinc-300">
              {license.hardwareId ? `${license.hardwareId.slice(0, 4)}…` : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Last verified</p>
            <p className="mt-1 text-zinc-200">
              {license.lastVerifiedAt ? formatRelative(license.lastVerifiedAt) : "never"}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black/40 px-4 py-3">
          <p className="text-sm text-zinc-300">No license on this account yet.</p>
          <a
            href={telegramChannelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-cyan-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-cyan-400"
          >
            Reach out on Telegram to get a license
          </a>
        </div>
      )}
    </section>
  );
}
