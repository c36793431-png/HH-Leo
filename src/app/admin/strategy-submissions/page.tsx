import Link from "next/link";
import {
  listStrategySubmissions,
  STRATEGY_SUBMISSION_STATUSES,
  type StrategySubmissionStatus,
} from "@/lib/strategy-submissions";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { StrategySubmissionRowActions } from "@/components/admin/strategy-submission-row-actions";
import { setStrategySubmissionStatusAction, setStrategySubmissionNotesAction } from "./actions";

const STATUS_STYLES: Record<StrategySubmissionStatus, string> = {
  pending: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
  under_review: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  approved_draft: "border-violet-500/40 bg-violet-500/15 text-violet-300",
  listed: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  declined: "border-red-500/40 bg-red-500/15 text-red-300",
  withdrawn: "border-zinc-600 bg-zinc-800/60 text-zinc-400",
};

interface RawSearchParams {
  status?: string;
}

function buildQuery(overrides: RawSearchParams): string {
  const params = new URLSearchParams();
  if (overrides.status) params.set("status", overrides.status);
  const qs = params.toString();
  return qs ? `?${qs}` : "/admin/strategy-submissions";
}

export default async function AdminStrategySubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const status = STRATEGY_SUBMISSION_STATUSES.includes(sp.status as StrategySubmissionStatus)
    ? (sp.status as StrategySubmissionStatus)
    : undefined;

  const submissions = await listStrategySubmissions({ status });

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Strategy submissions
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Strategy submissions</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Strategies authors have submitted for the catalog via /strategies &quot;Add your strategy&quot;.
        </p>
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
        {STRATEGY_SUBMISSION_STATUSES.map((s) => (
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
                <th className="pb-2 pr-4">Author</th>
                <th className="pb-2 pr-4">Strategy</th>
                <th className="pb-2 pr-4">Details</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {submissions.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(s.createdAt)} <span className="text-zinc-600">({formatRelative(s.createdAt)})</span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-200">
                    {s.authorName ?? "—"}
                    <div className="text-xs text-zinc-500">{s.authorEmail ?? "—"}</div>
                  </td>
                  <td className="py-2 pr-4 max-w-xs text-zinc-300">
                    {s.name}
                    <div className="mt-1 max-w-xs text-xs text-zinc-500" title={s.description}>
                      {s.description}
                    </div>
                  </td>
                  <td className="py-2 pr-4 max-w-xs text-zinc-400">
                    <div className="space-y-0.5 text-xs">
                      <div>category: {s.category}</div>
                      <div>instruments: {s.instruments.length ? s.instruments.join(", ") : "—"}</div>
                      <div>feed: {s.feedRegion ?? "—"}</div>
                      <div>contact: {s.contactPreference}</div>
                    </div>
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${STATUS_STYLES[s.status]}`}
                    >
                      {s.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2">
                    <StrategySubmissionRowActions
                      strategySubmissionId={s.id}
                      status={s.status}
                      notes={s.adminNotes ?? ""}
                      setStatusAction={setStrategySubmissionStatusAction}
                      setNotesAction={setStrategySubmissionNotesAction}
                    />
                  </td>
                </tr>
              ))}
              {submissions.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500">
                    No strategy submissions yet.
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
