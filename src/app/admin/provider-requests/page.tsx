import { listProviderRequestsForAdmin } from "@/lib/consult-provider-requests";
import { CONSULT_PROFILE_PATH } from "@/lib/consultant-profiles";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";

export const dynamic = "force-dynamic";

/** Portal admin list of clients' requests to service providers (consult S4, marcus m71393). In v1 the provider has no
 * inbox: admins relay each request. The admin layout checks admin. Client text renders as text. */
export default async function AdminProviderRequestsPage() {
  const rows = await listProviderRequestsForAdmin();
  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Provider requests
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Requests to service providers</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Clients&apos; requests from the Consulting &amp; Services marketplace. Providers do not see these yet: relay each
          one to the provider and reply to the client.
        </p>
      </header>
      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Sent</th>
                <th className="pb-2 pr-4">Provider</th>
                <th className="pb-2 pr-4">Client</th>
                <th className="pb-2 pr-4">Message</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(r.createdAt)} <span className="text-zinc-600">({formatRelative(r.createdAt)})</span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-200">
                    {r.providerName}
                    <div className="text-xs">
                      <a href={`${CONSULT_PROFILE_PATH}/${r.providerSlug}`} className="text-cyan-400 hover:underline">/{r.providerSlug}</a>
                    </div>
                  </td>
                  <td className="py-2 pr-4 text-xs text-zinc-300">
                    {r.clientEmail ?? "no email"}
                    {(r.clientTelegram || r.telegramHandle) && (
                      <div className="text-zinc-500">telegram: {r.clientTelegram ? `@${r.clientTelegram.replace(/^@/, "")}` : r.telegramHandle}</div>
                    )}
                  </td>
                  <td className="py-2 pr-4 max-w-[28rem] whitespace-pre-wrap break-words text-zinc-300">{r.message}</td>
                  <td className="py-2 text-xs uppercase text-zinc-400">{r.status}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500">No requests yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
