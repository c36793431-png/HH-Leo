import Link from "next/link";
import {
  CONSULTANT_APPLICATION_STATUSES,
  isSafeProfileUrl,
  listConsultantApplications,
  type ConsultantApplicationStatus,
} from "@/lib/consultant-applications";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { CONSULT_SERVICE_TYPE_LABELS } from "@/lib/consult-service-types";
import { listConsultantProfilesForAdmin } from "@/lib/consultant-profiles";
import { approveConsultantApplicationAction, declineConsultantApplicationAction, setConsultantProfileHiddenAction } from "./actions";
import { ConsultApplicationRowActions, ConsultProfileHideButton } from "./row-actions";

const STATUS_STYLES: Record<ConsultantApplicationStatus, string> = {
  pending: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  approved: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  declined: "border-red-500/40 bg-red-500/15 text-red-300",
};

function buildQuery(status?: string): string {
  return status ? `?status=${status}` : "/admin/consult-applications";
}

/** Portal admin queue for consultant applications (consult S1a). The admin layout and both actions check admin.
 * Applicant text renders as text; the profile link is a link only when it is http(s) (Fable m69076 S2). */
export default async function AdminConsultApplicationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = CONSULTANT_APPLICATION_STATUSES.includes(sp.status as ConsultantApplicationStatus)
    ? (sp.status as ConsultantApplicationStatus)
    : undefined;

  const [all, profiles] = await Promise.all([listConsultantApplications(), listConsultantProfilesForAdmin()]);
  const applications = status ? all.filter((a) => a.status === status) : all;
  const stats = Object.fromEntries(
    CONSULTANT_APPLICATION_STATUSES.map((s) => [s, all.filter((a) => a.status === s).length])
  ) as Record<ConsultantApplicationStatus, number>;

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Consultant applications
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Consultant applications</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Applications from consult.horizonhft.com. Approving grants no role and creates no account; it links an
          existing account with the same email, if there is exactly one.
        </p>
      </header>

      <div className="fttr-stats">
        {CONSULTANT_APPLICATION_STATUSES.map((s) => (
          <div key={s} className={`fttr-stat ${s}`}>
            <div className="n">{stats[s]}</div>
            <div className="l">{s}</div>
          </div>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {[undefined, ...CONSULTANT_APPLICATION_STATUSES].map((s) => (
          <Link
            key={s ?? "all"}
            href={buildQuery(s)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              status === s
                ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-300"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            {s ?? "All"}
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
                <th className="pb-2 pr-4">Expertise / background</th>
                <th className="pb-2 pr-4">Profile</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {applications.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(a.createdAt)} <span className="text-zinc-600">({formatRelative(a.createdAt)})</span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-200">
                    {a.name}
                    <div className="text-xs text-zinc-500">{a.email}</div>
                    {a.userId && <div className="text-xs text-emerald-500">linked account</div>}
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{a.telegram ?? "—"}</td>
                  <td className="py-2 pr-4 max-w-[22rem] whitespace-pre-wrap break-words text-zinc-300">
                    <div className="mb-1 text-xs text-cyan-300">
                      {a.serviceTypes.length === 0
                        ? <span className="text-zinc-600">services not stated</span>
                        : a.serviceTypes.map((t) => (t === "other" && a.serviceOther ? `Other: ${a.serviceOther}` : CONSULT_SERVICE_TYPE_LABELS[t])).join(" · ")}
                    </div>
                    {a.expertise}
                    {a.background && (
                      <details className="mt-1 text-xs text-zinc-500">
                        <summary className="cursor-pointer">Background</summary>
                        {a.background}
                      </details>
                    )}
                  </td>
                  <td className="py-2 pr-4 max-w-[14rem] break-all text-xs">
                    {a.profileUrl == null ? (
                      <span className="text-zinc-600">—</span>
                    ) : isSafeProfileUrl(a.profileUrl) ? (
                      <a href={a.profileUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-cyan-400 hover:underline">
                        {a.profileUrl}
                      </a>
                    ) : (
                      <span className="text-zinc-400">{a.profileUrl}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${STATUS_STYLES[a.status]}`}>
                      {a.status.toUpperCase()}
                    </span>
                    {a.decidedAt && (
                      <div className="mt-1 text-xs text-zinc-500">
                        {formatAbsoluteUtc(a.decidedAt)}
                        {a.decidedByEmail ? ` by ${a.decidedByEmail}` : ""}
                      </div>
                    )}
                    {a.declinedNote && <div className="mt-1 max-w-[12rem] text-xs text-zinc-500">Note: {a.declinedNote}</div>}
                  </td>
                  <td className="py-2">
                    {a.status === "pending" ? (
                      <ConsultApplicationRowActions
                        applicationId={a.id}
                        approveAction={approveConsultantApplicationAction}
                        declineAction={declineConsultantApplicationAction}
                      />
                    ) : profiles.get(a.id) ? (
                      <div className="text-xs text-zinc-400">
                        <div>
                          profile /{profiles.get(a.id)!.slug}:{" "}
                          {profiles.get(a.id)!.adminHidden ? "hidden by admin" : profiles.get(a.id)!.published ? "shown" : "not shown"}
                        </div>
                        <ConsultProfileHideButton profileId={profiles.get(a.id)!.id} hidden={profiles.get(a.id)!.adminHidden} action={setConsultantProfileHiddenAction} />
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {applications.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-zinc-500">
                    No consultant applications yet.
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
