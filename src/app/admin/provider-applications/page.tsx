import Link from "next/link";
import { listProviderApplications } from "@/lib/provider-applications";
import { formatRelative } from "@/lib/format-time";
import { ProviderApplicationRowActions } from "@/components/admin/provider-application-row-actions";
import { approveProviderApplicationAction, declineProviderApplicationAction } from "./actions";

export default async function AdminProviderApplicationsPage() {
  const [applications, approved] = await Promise.all([
    listProviderApplications({ status: "pending" }),
    listProviderApplications({ status: "approved" }),
  ]);
  const pendingOnboarding = approved.filter((a) => !a.onboardedAt);

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Provider applications
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Provider applications</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Feed provider signups from feed.horizonhft.com/providers/apply, pending review.
        </p>
      </header>

      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Company</th>
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Requested tier</th>
                <th className="pb-2 pr-4">Submitted</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {applications.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-4 text-teal-400">{a.name}</td>
                  <td className="py-2 pr-4 text-zinc-400">{a.email}</td>
                  <td className="py-2 pr-4 text-zinc-400">{a.tiersOffered ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-400">{formatRelative(a.appliedAt)}</td>
                  <td className="py-2">
                    <ProviderApplicationRowActions
                      applicationId={a.id}
                      approveAction={approveProviderApplicationAction}
                      declineAction={declineProviderApplicationAction}
                    />
                  </td>
                </tr>
              ))}
              {applications.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500">
                    No pending applications.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {pendingOnboarding.length > 0 && (
        <section className="mt-6 rounded-xl border border-amber-500/35 bg-amber-950/20 p-6">
          <h2 className="text-sm font-medium text-amber-300">Pending onboarding</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Approved but no tiers published yet — resume Register Provider to go live.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {pendingOnboarding.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-sm">
                <span className="text-teal-400">{a.name}</span>
                <Link
                  href={`/admin/register-provider?from_application=${a.id}`}
                  className="rounded bg-emerald-500 px-2 py-0.5 text-[11px] text-white hover:bg-emerald-600"
                >
                  Continue registration
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
