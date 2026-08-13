import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "@/lib/db";
import { getServerRegistration, getConnectionHistory } from "@/lib/server-registration";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { ActionButton } from "@/components/admin/action-button";
import { setMultipleIpsOkAction } from "../actions";

export default async function AdminConnectionDetailPage({
  params,
}: {
  params: Promise<{ licenseId: string }>;
}) {
  const { licenseId } = await params;

  const owner = await pool.query<{ email: string | null }>(
    `select u.email from licenses l left join users u on u.id = l.user_id where l.id = $1`,
    [licenseId]
  );
  if (owner.rowCount === 0) notFound();

  const [registration, history] = await Promise.all([
    getServerRegistration(licenseId),
    getConnectionHistory(licenseId, 10),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <Link href="/admin/connections" className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline">
          ← Connections
        </Link>
        <p className="mt-2 text-lg text-zinc-200">{owner.rows[0].email ?? "—"}</p>
      </header>

      <section className="mb-6 rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <h3 className="mb-3 text-sm font-semibold text-zinc-300">Declared registration</h3>
        {registration ? (
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div><span className="text-zinc-500">Server name:</span> {registration.serverName}</div>
            <div>
              <span className="text-zinc-500">VPS provider:</span>{" "}
              {registration.vpsProviderOther
                ? `${registration.vpsProvider} (${registration.vpsProviderOther})`
                : registration.vpsProvider}
            </div>
            <div><span className="text-zinc-500">Declared location:</span> {registration.serverLocation}</div>
            <div className="font-mono">
              <span className="font-sans text-zinc-500">Declared IP:</span> {registration.declaredIp}
            </div>
            <div><span className="text-zinc-500">Updated:</span> {formatAbsoluteUtc(registration.updatedAt)}</div>
            <div>
              <span className="text-zinc-500">Multiple IPs OK:</span>{" "}
              {registration.multipleIpsOk ? "yes" : "no"}
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No server registration submitted yet.</p>
        )}
        <div className="mt-4">
          <ActionButton
            action={setMultipleIpsOkAction}
            hiddenFields={{ licenseId, value: registration?.multipleIpsOk ? "false" : "true" }}
            label={registration?.multipleIpsOk ? "Disable multi-IP OK" : "Mark multi-IP OK (silence mismatch alerts)"}
            successMessage="Flag updated"
          />
        </div>
      </section>

      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <h3 className="mb-3 text-sm font-semibold text-zinc-300">Last {history.length} captured IPs</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">IP</th>
                <th className="pb-2 pr-4">Location</th>
                <th className="pb-2 pr-4">ISP</th>
                <th className="pb-2">Captured</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {history.map((h, i) => (
                <tr key={`${h.ip}-${i}`}>
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-300">{h.ip}</td>
                  <td className="py-2 pr-4 text-zinc-400">
                    {[h.city, h.country].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{h.isp ?? "—"}</td>
                  <td className="py-2 text-zinc-400">
                    {formatAbsoluteUtc(h.capturedAt)} <span className="text-zinc-600">({formatRelative(h.capturedAt)})</span>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-zinc-500">
                    No connections captured yet.
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
