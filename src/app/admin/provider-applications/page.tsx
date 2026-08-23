import { listProviderApplications } from "@/lib/provider-applications";
import { formatRelative } from "@/lib/format-time";
import { ProviderApplicationRowActions } from "@/components/admin/provider-application-row-actions";
import { approveProviderApplicationAction, declineProviderApplicationAction } from "./actions";

export default async function AdminProviderApplicationsPage() {
  const applications = await listProviderApplications({ status: "pending" });

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
                  <td className="py-2 pr-4 text-zinc-200">{a.name}</td>
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
    </div>
  );
}
