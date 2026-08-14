import Link from "next/link";
import { listFeedTierTrials, TRIAL_STATUSES, type TrialStatus } from "@/lib/feed-tier-trials";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";

const STATUS_STYLES: Record<TrialStatus, string> = {
  active: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  expired: "border-zinc-600/40 bg-zinc-600/15 text-zinc-400",
  converted: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  cancelled: "border-red-500/40 bg-red-500/15 text-red-300",
};

interface RawSearchParams {
  status?: string;
}

function buildQuery(overrides: RawSearchParams): string {
  const params = new URLSearchParams();
  if (overrides.status) params.set("status", overrides.status);
  const qs = params.toString();
  return qs ? `?${qs}` : "/admin/feed-tier-trials";
}

export default async function AdminFeedTierTrialsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const trialStatus = TRIAL_STATUSES.includes(sp.status as TrialStatus) ? (sp.status as TrialStatus) : undefined;

  const [trials, allTrials] = await Promise.all([
    listFeedTierTrials({ trialStatus }),
    trialStatus ? listFeedTierTrials() : Promise.resolve(null),
  ]);
  const statsSource = allTrials ?? trials;
  const stats = TRIAL_STATUSES.reduce(
    (acc, s) => {
      acc[s] = statsSource.filter((t) => t.trialStatus === s).length;
      return acc;
    },
    {} as Record<TrialStatus, number>
  );

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Feed tier trials
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Trial usage</h1>
        <p className="mt-1 text-sm text-zinc-400">
          LD Alpha / LD Ultra self-service trials, tracked separately from paid signup requests.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap gap-2">
        {TRIAL_STATUSES.map((s) => (
          <span key={s} className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400">
            {s}: {stats[s]}
          </span>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href={buildQuery({ status: undefined })}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            !trialStatus
              ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-300"
              : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          }`}
        >
          All
        </Link>
        {TRIAL_STATUSES.map((s) => (
          <Link
            key={s}
            href={buildQuery({ status: s })}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              trialStatus === s
                ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-300"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Started</th>
                <th className="pb-2 pr-4">User</th>
                <th className="pb-2 pr-4">License</th>
                <th className="pb-2 pr-4">Region / tier</th>
                <th className="pb-2 pr-4">Ends</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {trials.map((t) => (
                <tr key={t.id}>
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(t.trialStartedAt)}{" "}
                    <span className="text-zinc-600">({formatRelative(t.trialStartedAt)})</span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-200">
                    {t.userName ?? "—"}
                    <div className="text-xs text-zinc-500">{t.userEmail ?? "—"}</div>
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{t.licenseKeyTail ? `…${t.licenseKeyTail}` : "—"}</td>
                  <td className="py-2 pr-4 text-zinc-300">
                    {t.tierName}
                    <div className="text-xs text-zinc-500 uppercase">{t.region}</div>
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{formatAbsoluteUtc(t.trialEndsAt)}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${STATUS_STYLES[t.trialStatus]}`}
                    >
                      {t.trialStatus.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
              {trials.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500">
                    No trials yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
