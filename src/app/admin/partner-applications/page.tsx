import Link from "next/link";
import {
  listPartnerApplications,
  PARTNER_APPLICATION_STATUSES,
  type PartnerApplicationStatus,
} from "@/lib/partner-applications";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { PartnerApplicationRowActions } from "@/components/admin/partner-application-row-actions";
import { approvePartnerApplicationAction, declinePartnerApplicationAction } from "./actions";

const STATUS_STYLES: Record<PartnerApplicationStatus, string> = {
  pending: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  approved: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  declined: "border-red-500/40 bg-red-500/15 text-red-300",
};

interface RawSearchParams {
  status?: string;
}

function buildQuery(status?: string): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const qs = params.toString();
  return qs ? `?${qs}` : "/admin/partner-applications";
}

export default async function AdminPartnerApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const status = PARTNER_APPLICATION_STATUSES.includes(sp.status as PartnerApplicationStatus)
    ? (sp.status as PartnerApplicationStatus)
    : undefined;

  const [applications, allApplications] = await Promise.all([
    listPartnerApplications({ status }),
    status ? listPartnerApplications() : Promise.resolve(null),
  ]);
  const statsSource = allApplications ?? applications;
  const stats = PARTNER_APPLICATION_STATUSES.reduce(
    (acc, s) => {
      acc[s] = statsSource.filter((a) => a.status === s).length;
      return acc;
    },
    {} as Record<PartnerApplicationStatus, number>
  );

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Partner applications
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Partner applications</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Self-serve partner signups from partner.horizonhft.com/apply, pending review.
        </p>
      </header>

      <div className="fttr-stats">
        {PARTNER_APPLICATION_STATUSES.map((s) => (
          <div key={s} className={`fttr-stat ${s}`}>
            <div className="n">{stats[s]}</div>
            <div className="l">{s}</div>
          </div>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href={buildQuery(undefined)}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            !status
              ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-300"
              : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          }`}
        >
          All
        </Link>
        {PARTNER_APPLICATION_STATUSES.map((s) => (
          <Link
            key={s}
            href={buildQuery(s)}
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
                <th className="pb-2 pr-4">Applied</th>
                <th className="pb-2 pr-4">Name / email</th>
                <th className="pb-2 pr-4">Telegram</th>
                <th className="pb-2 pr-4">Notes</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {applications.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(a.appliedAt)} <span className="text-zinc-600">({formatRelative(a.appliedAt)})</span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-200">
                    {a.name}
                    <div className="text-xs text-zinc-500">{a.email}</div>
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{a.telegram ?? "—"}</td>
                  <td className="py-2 pr-4 max-w-[16rem] truncate text-zinc-400" title={a.notes ?? undefined}>
                    {a.notes ?? "—"}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${STATUS_STYLES[a.status]}`}
                    >
                      {a.status.toUpperCase()}
                    </span>
                    {a.adminNotes && <div className="mt-1 max-w-[12rem] text-xs text-zinc-500">{a.adminNotes}</div>}
                  </td>
                  <td className="py-2">
                    {a.status === "pending" ? (
                      <PartnerApplicationRowActions
                        applicationId={a.id}
                        approveAction={approvePartnerApplicationAction}
                        declineAction={declinePartnerApplicationAction}
                      />
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {applications.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500">
                    No partner applications yet.
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
