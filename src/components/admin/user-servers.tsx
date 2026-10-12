import { formatRelative } from "@/lib/format-time";
import { maskLicenseKey } from "@/lib/licenses";
import type { AdminUserServerRow } from "@/lib/server-registration";

/** Read-only list of every server a user owns on /admin/users/[id] (marcus m65584 Q-S1).
 * Editing, the multiple-IPs flag and IP history stay on /admin/connections/[licenseId], which a
 * server reaches once it has a licence. */
export function AdminUserServers({ rows }: { rows: AdminUserServerRow[] }) {
  return (
    <table className="w-full text-left text-xs">
      <thead className="text-zinc-500">
        <tr>
          <th className="py-1 pr-3 font-normal">Server</th>
          <th className="py-1 pr-3 font-normal">Location</th>
          <th className="py-1 pr-3 font-normal">IP</th>
          <th className="py-1 pr-3 font-normal">Licence</th>
          <th className="py-1 font-normal">Updated</th>
        </tr>
      </thead>
      <tbody className="text-zinc-200">
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-zinc-800">
            <td className="py-1 pr-3">{r.serverName}</td>
            <td className="py-1 pr-3">{r.serverLocation}</td>
            <td className="py-1 pr-3 font-mono">{r.declaredIp}</td>
            <td className="py-1 pr-3 font-mono">
              {r.licenseKey ? maskLicenseKey(r.licenseKey) : <span className="text-zinc-500">Not linked</span>}
            </td>
            <td className="py-1 text-zinc-500">{formatRelative(r.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
