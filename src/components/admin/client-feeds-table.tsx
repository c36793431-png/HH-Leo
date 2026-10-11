import Link from "next/link";
import type { ClientFeedRow } from "@/lib/client-feeds";
import { FEED_REGION_LABELS } from "@/lib/feed-tier-catalogue";
import { formatAbsoluteUtc } from "@/lib/format-time";

const STATUS_CLASS: Record<string, string> = {
  active: "text-emerald-400",
  trial: "text-sky-300",
  lapsed: "text-zinc-500",
};

function clientLabel(r: ClientFeedRow): string {
  if (r.email) return r.email;
  if (r.telegramUsername) return `@${r.telegramUsername.replace(/^@/, "")}`;
  return `user ${r.userId.slice(0, 8)}`;
}

function allowlistLabel(r: ClientFeedRow): string {
  const parts: string[] = [];
  if (r.allowlistOpenIps.length) parts.push(`open ${r.allowlistOpenIps.join(", ")}`);
  if (r.allowlistRevokedCount) parts.push(`${r.allowlistRevokedCount} revoked`);
  return parts.join(" · ") || "none";
}

/** The /admin/client-feeds table (marcus m63917 B2). Display only: the rows come from listClientFeeds. */
export function ClientFeedsTable({ rows }: { rows: ClientFeedRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-zinc-500">
          <tr>
            <th className="pb-2 pr-4">Client</th>
            <th className="pb-2 pr-4">Tier</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">Trial / paid</th>
            <th className="pb-2 pr-4">Started</th>
            <th className="pb-2 pr-4">Ends</th>
            <th className="pb-2 pr-4">Price</th>
            <th className="pb-2 pr-4">Server</th>
            <th className="pb-2">Allowlist</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {rows.map((r) => (
            <tr key={r.subscriptionId} className={r.pastEndStillActive ? "bg-amber-500/10" : undefined}>
              <td className="py-2 pr-4 text-zinc-200">
                <Link href={`/admin/users/${r.userId}`} className="hover:text-cyan-300 hover:underline">
                  {clientLabel(r)}
                </Link>
                {r.displayName ? <div className="text-xs text-zinc-500">{r.displayName}</div> : null}
              </td>
              <td className="py-2 pr-4 text-zinc-300">
                {r.tierName}
                {r.region ? <div className="text-xs text-zinc-500">{FEED_REGION_LABELS[r.region]}</div> : null}
              </td>
              <td className="py-2 pr-4">
                <span className={STATUS_CLASS[r.status] ?? "text-zinc-300"}>{r.status}</span>
                {r.pastEndStillActive ? (
                  <div className="mt-1">
                    <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
                      past end, still active
                    </span>
                  </div>
                ) : null}
              </td>
              <td className="py-2 pr-4 text-zinc-400">{r.grant ?? "—"}</td>
              <td className="py-2 pr-4 text-xs text-zinc-400">{formatAbsoluteUtc(r.startedAt)}</td>
              <td className="py-2 pr-4 text-xs text-zinc-400">{r.endsAt ? formatAbsoluteUtc(r.endsAt) : "—"}</td>
              <td className="py-2 pr-4 text-zinc-400">{r.priceCents == null ? "unpriced" : `$${(r.priceCents / 100).toFixed(2)}`}</td>
              <td className="py-2 pr-4 text-zinc-400">
                {r.serverName ?? "—"}
                {r.declaredIp ? <div className="font-mono text-xs text-zinc-500">{r.declaredIp}</div> : null}
              </td>
              <td className="py-2 text-xs text-zinc-400">{allowlistLabel(r)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="py-4 text-center text-zinc-500">
                No feed subscriptions.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
