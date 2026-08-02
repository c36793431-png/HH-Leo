import {
  getUserCounts,
  getRecentSignups,
  getRecentLicenseActivity,
  getSignupsPerDay,
  getRevenueStats,
} from "@/lib/admin-dashboard";
import Link from "next/link";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { maskLicenseKey } from "@/lib/licenses";

/** "YYYY-MM-DD" -> "Jul 1" for sparkline x-axis ticks. */
function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

const ACTIVITY_STYLES: Record<string, { label: string; color: string }> = {
  issued: { label: "Issued", color: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" },
  revoked: { label: "Revoked", color: "border-red-500/40 bg-red-500/15 text-red-300" },
  expired: { label: "Expired", color: "border-amber-500/40 bg-amber-500/15 text-amber-300" },
};

const SIGNUP_STATUS_STYLES: Record<string, string> = {
  Free: "text-zinc-500",
  Trial: "text-amber-400",
  Paid: "text-emerald-400",
  Team: "text-cyan-400",
  Deal: "text-purple-400",
  Lapsed: "text-rose-400",
};

export default async function AdminDashboardPage() {
  const [counts, signups, activity, sparkline, revenue] = await Promise.all([
    getUserCounts(),
    getRecentSignups(10),
    getRecentLicenseActivity(10),
    getSignupsPerDay(30),
    getRevenueStats(),
  ]);

  const maxSparkline = Math.max(1, ...sparkline.map((d) => d.count));
  const sparklineTicks = [4, 3, 2, 1, 0].map((i) => Math.round((maxSparkline * i) / 4));

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Dashboard
        </span>
        <p className="mt-2 text-sm text-zinc-400">Business aggregates across users, licenses, and revenue.</p>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile
          label="Gross received"
          value={`$${revenue.grossIn.toFixed(2)}`}
          sub={`This month: $${revenue.grossInThisMonth.toFixed(2)}`}
        />
        <StatTile
          label="Costs"
          value={`$${revenue.feedCost.toFixed(2)}`}
          sub={`Monthly rate · ${revenue.feedCostLicenseCount} active license${revenue.feedCostLicenseCount === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Net revenue"
          value={`$${revenue.net.toFixed(2)}`}
          sub={`This month: $${revenue.netThisMonth.toFixed(2)}`}
        />
        <StatTile label="MRR" value={`$${revenue.mrr.toFixed(2)}`} sub="proxy: this month's customer payments" />
        <StatTile label="Total users" value={String(counts.total)} />
        <StatTile label="Paid customers" value={String(counts.paid)} />
        <StatTile label="Trial" value={String(counts.trial)} />
        <StatTile label="Team" value={String(counts.team)} />
        <StatTile label="Deal" value={String(counts.deal)} sub="barter/swap — not revenue" />
        <StatTile label="Free" value={String(counts.free)} />
        <StatTile label="Lapsed" value={String(counts.lapsed)} />
        <StatTile label="Admins" value={String(counts.admins)} />
      </section>

      <section className="mb-8 rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <h2 className="text-sm font-medium text-cyan-400">New signups — last 30 days</h2>
        <div className="mt-4 flex h-16 gap-2">
          <div className="flex h-16 w-4 flex-col justify-between text-right text-[10px] leading-none text-zinc-500">
            {sparklineTicks.map((v, i) => (
              <span key={i}>{v}</span>
            ))}
          </div>
          <div className="relative h-16 flex-1">
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="border-t border-teal-300/40" />
              ))}
            </div>
            <div className="relative flex h-16 items-end gap-0.5">
              {sparkline.map((d) => (
                <div
                  key={d.date}
                  title={`${d.date}: ${d.count}`}
                  className="flex-1 rounded-t bg-cyan-500/60"
                  style={{ height: `${Math.max(4, (d.count / maxSparkline) * 100)}%` }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="mt-1 flex gap-2">
          <div className="w-4 shrink-0" />
          <div className="flex flex-1 gap-0.5 text-[10px] text-[#e5e5e5]">
            {sparkline.map((d, i) => {
              const isEdge = i === 0 || i === sparkline.length - 1;
              const isWeeklyTick = i % 7 === 0;
              return (
                <div key={d.date} className="flex-1 text-center">
                  {isEdge || isWeeklyTick ? formatShortDate(d.date) : ""}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
          <h2 className="text-sm font-medium text-blue-400">Recent signups</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="pb-2 pr-4">Email</th>
                  <th className="pb-2 pr-4">Signed up</th>
                  <th className="pb-2">Tier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {signups.map((s) => (
                  <tr key={s.userId} className="group cursor-pointer hover:bg-zinc-900/60">
                    <td className="py-2 pr-4 text-zinc-200">
                      <Link
                        href={`/admin/users/${s.userId}`}
                        className="block group-hover:text-cyan-300 group-hover:underline"
                      >
                        {s.email ?? s.displayName ?? "—"}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-zinc-400">
                      <Link href={`/admin/users/${s.userId}`} className="block">
                        {formatRelative(s.createdAt)}
                      </Link>
                    </td>
                    <td className={`py-2 ${SIGNUP_STATUS_STYLES[s.statusLabel]}`}>
                      <Link href={`/admin/users/${s.userId}`} className="block">
                        {s.statusLabel}
                      </Link>
                    </td>
                  </tr>
                ))}
                {signups.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-zinc-500">
                      No signups yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
          <h2 className="text-sm font-medium text-emerald-400">Recent license activity</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="pb-2 pr-4">Event</th>
                  <th className="pb-2 pr-4">License</th>
                  <th className="pb-2 pr-4">User</th>
                  <th className="pb-2">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {activity.map((a, i) => {
                  const style = ACTIVITY_STYLES[a.type];
                  return (
                    <tr key={i}>
                      <td className="py-2 pr-4">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${style.color}`}>
                          {style.label}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-zinc-400">
                        {a.licenseKey ? maskLicenseKey(a.licenseKey) : "—"}
                      </td>
                      <td className="py-2 pr-4 text-zinc-400">{a.userEmail ?? "—"}</td>
                      <td className="py-2 text-zinc-500" title={formatAbsoluteUtc(a.at)}>
                        {formatRelative(a.at)}
                      </td>
                    </tr>
                  );
                })}
                {activity.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-zinc-500">
                      No license activity yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
