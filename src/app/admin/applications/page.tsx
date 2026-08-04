import Link from "next/link";
import { listApplications, APPLICATION_STATUSES, type ApplicationStatus } from "@/lib/applications";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { ApplicationRowActions } from "@/components/admin/application-row-actions";
import { setApplicationStatusAction, setApplicationNotesAction } from "./actions";

const STATUS_STYLES: Record<ApplicationStatus, string> = {
  new: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
  reviewed: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  contacted: "border-blue-500/40 bg-blue-500/15 text-blue-300",
  hired: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  rejected: "border-red-500/40 bg-red-500/15 text-red-300",
};

interface RawSearchParams {
  status?: string;
}

function buildQuery(overrides: RawSearchParams): string {
  const params = new URLSearchParams();
  if (overrides.status) params.set("status", overrides.status);
  const qs = params.toString();
  return qs ? `?${qs}` : "/admin/applications";
}

export default async function AdminApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const status = APPLICATION_STATUSES.includes(sp.status as ApplicationStatus)
    ? (sp.status as ApplicationStatus)
    : undefined;

  const applications = await listApplications({ status });

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Applications
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Careers applications</h1>
        <p className="mt-1 text-sm text-zinc-400">CV applications submitted via /careers.</p>
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
        {APPLICATION_STATUSES.map((s) => (
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
                <th className="pb-2 pr-4">Created</th>
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Role</th>
                <th className="pb-2 pr-4">Message</th>
                <th className="pb-2 pr-4">CV</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {applications.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(a.createdAt)} <span className="text-zinc-600">({formatRelative(a.createdAt)})</span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-200">{a.name}</td>
                  <td className="py-2 pr-4 text-zinc-300">{a.email}</td>
                  <td className="py-2 pr-4 text-zinc-400">{a.roleInterest}</td>
                  <td className="py-2 pr-4 max-w-xs truncate text-zinc-400" title={a.message ?? undefined}>
                    {a.message ?? "—"}
                  </td>
                  <td className="py-2 pr-4">
                    {a.cvUrl ? (
                      <a
                        href={`/api/admin/applications/cv/${a.id}`}
                        className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300"
                      >
                        Download
                      </a>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${STATUS_STYLES[a.status]}`}
                    >
                      {a.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2">
                    <ApplicationRowActions
                      applicationId={a.id}
                      status={a.status}
                      notes={a.adminNotes ?? ""}
                      setStatusAction={setApplicationStatusAction}
                      setNotesAction={setApplicationNotesAction}
                    />
                  </td>
                </tr>
              ))}
              {applications.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-zinc-500">
                    No applications yet.
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
