import Link from "next/link";
import { listFeedRequests, FEED_REQUEST_STATUSES, type FeedRequestStatus } from "@/lib/feed-requests";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { FeedRequestRowActions } from "@/components/admin/feed-request-row-actions";
import { setFeedRequestStatusAction, setFeedRequestNotesAction } from "./actions";

const STATUS_STYLES: Record<FeedRequestStatus, string> = {
  new: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
  reviewing: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  declined: "border-red-500/40 bg-red-500/15 text-red-300",
  shipped: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
};

interface RawSearchParams {
  status?: string;
}

function buildQuery(overrides: RawSearchParams): string {
  const params = new URLSearchParams();
  if (overrides.status) params.set("status", overrides.status);
  const qs = params.toString();
  return qs ? `?${qs}` : "/admin/feed-requests";
}

export default async function AdminFeedRequestsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const status = FEED_REQUEST_STATUSES.includes(sp.status as FeedRequestStatus)
    ? (sp.status as FeedRequestStatus)
    : undefined;

  const requests = await listFeedRequests({ status });

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Feed requests
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Feed requests</h1>
        <p className="mt-1 text-sm text-zinc-400">Feeds users have asked for via /feeds.</p>
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
        {FEED_REQUEST_STATUSES.map((s) => (
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
                <th className="pb-2 pr-4">User</th>
                <th className="pb-2 pr-4">Venue / feed</th>
                <th className="pb-2 pr-4">Use case</th>
                <th className="pb-2 pr-4">Preferred location</th>
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
                  <td className="py-2 pr-4 text-zinc-200">
                    {r.userName ?? "—"}
                    <div className="text-xs text-zinc-500">{r.userEmail ?? "—"}</div>
                  </td>
                  <td className="py-2 pr-4 max-w-xs text-zinc-300">{r.venueText}</td>
                  <td className="py-2 pr-4 max-w-xs text-zinc-400" title={r.useCaseText}>
                    {r.useCaseText}
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{r.preferredLocation ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${STATUS_STYLES[r.status]}`}
                    >
                      {r.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2">
                    <FeedRequestRowActions
                      feedRequestId={r.id}
                      status={r.status}
                      notes={r.adminNotes ?? ""}
                      setStatusAction={setFeedRequestStatusAction}
                      setNotesAction={setFeedRequestNotesAction}
                    />
                  </td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-zinc-500">
                    No feed requests yet.
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
