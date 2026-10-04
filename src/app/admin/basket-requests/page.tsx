import Link from "next/link";
import { listBasketRequests, BASKET_REQUEST_STATUSES, type BasketRequestStatus } from "@/lib/basket-requests";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { setBasketRequestHandledAction } from "./actions";

/**
 * Admin · Basket requests (marcus m59146). One row per basket a client sent: who, when, every
 * line as it was at submit, the trial choice. Nothing here grants anything: fulfil with the
 * existing tools (Issue licence, Assign feed tier on /admin/users), then mark it Handled. The
 * request is handled as a whole (New / Handled), never per line.
 */
const STATUS_STYLES: Record<BasketRequestStatus, string> = {
  new: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
  handled: "border-zinc-600 bg-zinc-800/60 text-zinc-300",
};

function buildQuery(status: BasketRequestStatus | undefined): string {
  return status ? `?status=${status}` : "/admin/basket-requests";
}

export default async function AdminBasketRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = BASKET_REQUEST_STATUSES.includes(sp.status as BasketRequestStatus) ? (sp.status as BasketRequestStatus) : undefined;
  const requests = await listBasketRequests({ status });

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Basket requests
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Basket requests</h1>
        <p className="mt-1 text-sm text-zinc-400">
          What clients sent from the marketplace basket. Nothing is granted by a request: fulfil by hand (Issue licence,
          Assign feed tier on Users), then mark it handled.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap gap-2">
        {([undefined, ...BASKET_REQUEST_STATUSES] as (BasketRequestStatus | undefined)[]).map((s) => (
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
                <th className="pb-2 pr-4">Submitted</th>
                <th className="pb-2 pr-4">Client</th>
                <th className="pb-2 pr-4">Lines</th>
                <th className="pb-2 pr-4">Trial</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {requests.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-3 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(r.submittedAt)} <span className="text-zinc-600">({formatRelative(r.submittedAt)})</span>
                    <div className="font-mono text-xs text-zinc-500">{r.reference}</div>
                  </td>
                  <td className="py-3 pr-4 text-zinc-200">
                    <Link href={`/admin/users/${r.userId}`} className="hover:underline">
                      {r.userName ?? r.userEmail ?? "—"}
                    </Link>
                    <div className="text-xs text-zinc-500">{r.userEmail ?? "—"}</div>
                    <div className="text-xs text-zinc-500">telegram: {r.telegram ? `@${r.telegram}` : "none on file"}</div>
                  </td>
                  <td className="py-3 pr-4 text-zinc-300">
                    <ul className="space-y-0.5">
                      {r.lines.map((l) => (
                        <li key={`${l.kind}:${l.key}`}>
                          {l.name}{" "}
                          <span className="text-xs text-zinc-500">
                            ({l.kind}
                            {l.kind === "feed" ? `, ${l.servers ?? 1} server${(l.servers ?? 1) === 1 ? "" : "s"}` : ""})
                            {l.kind === "feed" && l.note ? ` · ${l.note}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="py-3 pr-4 text-zinc-300">{r.hasTrial ? "30-day trial requested" : "—"}</td>
                  <td className="py-3 pr-4">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${STATUS_STYLES[r.status]}`}>
                      {r.status.toUpperCase()}
                    </span>
                    {r.handledAt && (
                      <div className="mt-1 text-xs text-zinc-500">
                        {formatAbsoluteUtc(r.handledAt)}
                        {r.handledByEmail ? ` · ${r.handledByEmail}` : ""}
                      </div>
                    )}
                  </td>
                  <td className="py-3">
                    <form action={setBasketRequestHandledAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="handled" value={r.status === "new" ? "1" : "0"} />
                      <button
                        type="submit"
                        className="whitespace-nowrap rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:border-cyan-400 hover:text-cyan-300"
                      >
                        {r.status === "new" ? "Mark handled" : "Reopen"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500">
                    No basket requests{status ? ` with status ${status}` : " yet"}.
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
