import {
  listTopReferrers,
  listPendingPayouts,
  listAllReferralEarnings,
  REFERRAL_MIN_PAYOUT_USD,
} from "@/lib/referrals";
import { formatAbsoluteUtc } from "@/lib/format-time";
import { MarkPaidButton, ClawbackButton } from "@/components/admin/referral-action-buttons";

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  pending: "text-amber-400",
  cleared: "text-cyan-400",
  paid: "text-emerald-400",
  clawback: "text-red-400",
};

function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default async function AdminReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const [topReferrers, pendingPayouts, earnings] = await Promise.all([
    listTopReferrers(),
    listPendingPayouts(),
    listAllReferralEarnings(q),
  ]);

  const totalCleared = topReferrers.reduce((sum, r) => sum + r.clearedUsd, 0);
  const totalPending = topReferrers.reduce((sum, r) => sum + r.pendingUsd, 0);
  const totalPaid = topReferrers.reduce((sum, r) => sum + r.paidUsd, 0);

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Referrals
        </span>
        <p className="mt-2 text-sm text-zinc-400">
          30% recurring commission, 14-day clawback window, ${REFERRAL_MIN_PAYOUT_USD} minimum monthly payout.
        </p>
      </header>

      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Cleared (payout-eligible)" value={fmt(totalCleared)} />
        <StatTile label="Pending (14-day window)" value={fmt(totalPending)} />
        <StatTile label="Paid out (all-time)" value={fmt(totalPaid)} />
      </section>

      <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-emerald-400">Pending payouts (≥ ${REFERRAL_MIN_PAYOUT_USD})</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Referrer</th>
                <th className="pb-2 pr-4">Cleared</th>
                <th className="pb-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {pendingPayouts.map((p) => (
                <tr key={p.referrerUserId}>
                  <td className="py-2 pr-4 text-zinc-200">{p.email ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-200">{fmt(p.clearedUsd)}</td>
                  <td className="py-2">
                    <MarkPaidButton referrerUserId={p.referrerUserId} />
                  </td>
                </tr>
              ))}
              {pendingPayouts.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-zinc-500">
                    No referrer has crossed the ${REFERRAL_MIN_PAYOUT_USD} minimum yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-cyan-400">Top referrers</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Referrer</th>
                <th className="pb-2 pr-4">Referrals</th>
                <th className="pb-2 pr-4">Cleared</th>
                <th className="pb-2 pr-4">Pending</th>
                <th className="pb-2">Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {topReferrers.map((r) => (
                <tr key={r.referrerUserId}>
                  <td className="py-2 pr-4 text-zinc-200">{r.email ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-400">{r.referralCount}</td>
                  <td className="py-2 pr-4 text-zinc-200">{fmt(r.clearedUsd)}</td>
                  <td className="py-2 pr-4 text-zinc-400">{fmt(r.pendingUsd)}</td>
                  <td className="py-2 text-zinc-400">{fmt(r.paidUsd)}</td>
                </tr>
              ))}
              {topReferrers.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-zinc-500">
                    No referral earnings recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-blue-400">All earnings</h2>
          <form className="flex items-center gap-2">
            <input
              type="text"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search referrer or referred email"
              className="rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
            />
            <button type="submit" className="rounded-md bg-cyan-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-cyan-400">
              Search
            </button>
          </form>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Referrer</th>
                <th className="pb-2 pr-4">Referred</th>
                <th className="pb-2 pr-4">Amount</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {earnings.map((e) => (
                <tr key={e.id}>
                  <td className="py-2 pr-4 text-zinc-400" title={formatAbsoluteUtc(e.earnedAt)}>
                    {e.earnedAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="py-2 pr-4 text-zinc-200">{e.referrerEmail ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-200">{e.referredEmail ?? "—"}</td>
                  <td className="py-2 pr-4 text-zinc-200">{fmt(e.amountUsd)}</td>
                  <td className={`py-2 pr-4 font-medium ${STATUS_STYLES[e.status] ?? "text-zinc-400"}`}>{e.status}</td>
                  <td className="py-2">
                    {(e.status === "pending" || e.status === "cleared") && <ClawbackButton earningId={e.id} />}
                  </td>
                </tr>
              ))}
              {earnings.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-zinc-500">
                    No earnings logged yet.
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
