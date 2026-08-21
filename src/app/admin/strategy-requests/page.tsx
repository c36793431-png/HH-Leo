import Link from "next/link";
import { listStrategyRequests, STRATEGY_REQUEST_STATUSES, type StrategyRequestStatus } from "@/lib/strategy-requests";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { StrategyRequestRowActions } from "@/components/admin/strategy-request-row-actions";
import { setStrategyRequestStatusAction, setStrategyRequestNotesAction } from "./actions";

const STATUS_STYLES: Record<StrategyRequestStatus, string> = {
  new: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
  reviewing: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  declined: "border-red-500/40 bg-red-500/15 text-red-300",
  scoping: "border-violet-500/40 bg-violet-500/15 text-violet-300",
  shipped: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
};

interface RawSearchParams {
  status?: string;
}

function buildQuery(overrides: RawSearchParams): string {
  const params = new URLSearchParams();
  if (overrides.status) params.set("status", overrides.status);
  const qs = params.toString();
  return qs ? `?${qs}` : "/admin/strategy-requests";
}

export default async function AdminStrategyRequestsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const status = STRATEGY_REQUEST_STATUSES.includes(sp.status as StrategyRequestStatus)
    ? (sp.status as StrategyRequestStatus)
    : undefined;

  const requests = await listStrategyRequests({ status });

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Strategy requests
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Strategy requests</h1>
        <p className="mt-1 text-sm text-zinc-400">Strategies users have asked for via /strategies.</p>
      </header>

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
        {STRATEGY_REQUEST_STATUSES.map((s) => (
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
                <th className="pb-2 pr-4">Submitted</th>
                <th className="pb-2 pr-4">Type</th>
                <th className="pb-2 pr-4">User</th>
                <th className="pb-2 pr-4">Idea / Strategy</th>
                <th className="pb-2 pr-4">Details</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(r.submittedAt)} <span className="text-zinc-600">({formatRelative(r.submittedAt)})</span>
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${
                        r.submissionType === "structured"
                          ? "border-blue-500/40 bg-blue-500/15 text-blue-300"
                          : "border-zinc-600 bg-zinc-800/60 text-zinc-400"
                      }`}
                    >
                      {r.submissionType === "structured" ? "BUILD" : "PITCH"}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-200">
                    {r.userName ?? "—"}
                    <div className="text-xs text-zinc-500">{r.userEmail ?? "—"}</div>
                  </td>
                  <td className="py-2 pr-4 max-w-xs text-zinc-300" title={r.ideaText}>
                    {r.submissionType === "structured" ? r.strategyName ?? "—" : r.ideaText}
                    {r.submissionType === "structured" && (
                      <div className="mt-1 max-w-xs text-xs text-zinc-500" title={r.ideaText}>
                        {r.ideaText}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-4 max-w-xs text-zinc-400">
                    {r.submissionType === "structured" ? (
                      <div className="space-y-0.5 text-xs">
                        <div>category: {r.category ?? "—"}</div>
                        <div>instruments: {r.instruments?.length ? r.instruments.join(", ") : "—"}</div>
                        <div>feed: {r.feedRequirement ?? "—"}</div>
                        <div>contact: {r.contactPreference ?? "—"}</div>
                      </div>
                    ) : (
                      <div className="space-y-0.5 text-xs">
                        <div>asset: {r.assetText ?? "—"}</div>
                        <div>timeframe: {r.timeframeText ?? "—"}</div>
                        <div title={r.referencesText ?? undefined}>refs: {r.referencesText ?? "—"}</div>
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${STATUS_STYLES[r.status]}`}
                    >
                      {r.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2">
                    <StrategyRequestRowActions
                      strategyRequestId={r.id}
                      status={r.status}
                      notes={r.adminNotes ?? ""}
                      setStatusAction={setStrategyRequestStatusAction}
                      setNotesAction={setStrategyRequestNotesAction}
                    />
                  </td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-zinc-500">
                    No strategy requests yet.
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
