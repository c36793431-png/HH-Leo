import { listBlackTrials, BLACK_TRIAL_STATUSES, type BlackTrialStatus } from "@/lib/black-trials";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { BlackTrialRowActions } from "@/components/admin/black-trial-row-actions";
import { approveBlackTrialAction, declineBlackTrialAction } from "./actions";
import Link from "next/link";

const STATUS_STYLES: Record<BlackTrialStatus, string> = {
  requested: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  active: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  declined: "border-red-500/40 bg-red-500/15 text-red-300",
  converted: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
};

interface RawSearchParams {
  status?: string;
}

function buildQuery(overrides: RawSearchParams): string {
  const params = new URLSearchParams();
  if (overrides.status) params.set("status", overrides.status);
  const qs = params.toString();
  return qs ? `?${qs}` : "/admin/black-trials";
}

export default async function AdminBlackTrialsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const status = BLACK_TRIAL_STATUSES.includes(sp.status as BlackTrialStatus) ? (sp.status as BlackTrialStatus) : undefined;

  const [requests, allRequests] = await Promise.all([
    listBlackTrials(status),
    status ? listBlackTrials() : Promise.resolve(null),
  ]);
  const statsSource = allRequests ?? requests;
  const stats = BLACK_TRIAL_STATUSES.reduce(
    (acc, s) => {
      acc[s] = statsSource.filter((r) => r.status === s).length;
      return acc;
    },
    {} as Record<BlackTrialStatus, number>
  );

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Black trials
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Black feed trial requests</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Paid-only, self-service, one-per-desk. Whitelist the server IP at BFF first, then paste
          the endpoint/credentials it hands back to activate.
        </p>
      </header>

      <div className="fttr-stats">
        {BLACK_TRIAL_STATUSES.map((s) => (
          <div key={s} className={`fttr-stat ${s}`}>
            <div className="n">{stats[s]}</div>
            <div className="l">{s}</div>
          </div>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href={buildQuery({ status: undefined })}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            !status
              ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-300"
              : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          }`}
        >
          All
        </Link>
        {BLACK_TRIAL_STATUSES.map((s) => (
          <Link
            key={s}
            href={buildQuery({ status: s })}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              status === s
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
                <th className="pb-2 pr-4">Requested</th>
                <th className="pb-2 pr-4">User</th>
                <th className="pb-2 pr-4">License</th>
                <th className="pb-2 pr-4">Server</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(r.requestedAt)} <span className="text-zinc-600">({formatRelative(r.requestedAt)})</span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-200">
                    {r.userName ?? "—"}
                    <div className="text-xs text-zinc-500">{r.userEmail ?? "—"}</div>
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{r.licenseKeyTail ? `…${r.licenseKeyTail}` : "—"}</td>
                  <td className="py-2 pr-4 text-zinc-400">
                    {r.serverName ?? "—"}
                    <div className="text-xs text-zinc-500">{r.serverIp ?? "—"}</div>
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${STATUS_STYLES[r.status]}`}>
                      {r.status.toUpperCase()}
                    </span>
                    {r.status === "active" && r.expiresAt && (
                      <div className="mt-1 text-xs text-zinc-500">expires {formatAbsoluteUtc(r.expiresAt)}</div>
                    )}
                    {r.reason && <div className="mt-1 max-w-[12rem] text-xs text-zinc-500">{r.reason}</div>}
                  </td>
                  <td className="py-2">
                    {r.status === "requested" ? (
                      <BlackTrialRowActions requestId={r.id} approveAction={approveBlackTrialAction} declineAction={declineBlackTrialAction} />
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500">
                    No Black trial requests yet.
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
