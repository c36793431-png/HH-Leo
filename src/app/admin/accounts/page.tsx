import { listFeedTierRequests } from "@/lib/feed-tier-requests";
import { listFeedTierTrials } from "@/lib/feed-tier-trials";
import { listBlackTrials } from "@/lib/black-trials";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";

type AccountSource = "signup" | "trial" | "black-trial";

interface AccountRow {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  sources: AccountSource[];
  latestAt: Date;
  latestStatus: string;
}

const SOURCE_LABEL: Record<AccountSource, string> = {
  signup: "Feed signup",
  trial: "Feed trial",
  "black-trial": "Black trial",
};

export default async function AdminAccountsPage() {
  const [requests, trials, blackTrials] = await Promise.all([
    listFeedTierRequests(),
    listFeedTierTrials(),
    listBlackTrials(),
  ]);

  const byUser = new Map<string, AccountRow>();

  const merge = (
    userId: string,
    userName: string | null,
    userEmail: string | null,
    source: AccountSource,
    at: Date,
    status: string
  ) => {
    const existing = byUser.get(userId);
    if (!existing) {
      byUser.set(userId, { userId, userName, userEmail, sources: [source], latestAt: at, latestStatus: status });
      return;
    }
    if (!existing.sources.includes(source)) existing.sources.push(source);
    if (at > existing.latestAt) {
      existing.latestAt = at;
      existing.latestStatus = status;
    }
  };

  for (const r of requests) merge(r.userId, r.userName, r.userEmail, "signup", r.createdAt, r.status);
  for (const t of trials) merge(t.userId, t.userName, t.userEmail, "trial", t.trialStartedAt, t.trialStatus);
  for (const b of blackTrials) merge(b.userId, b.userName, b.userEmail, "black-trial", b.requestedAt, b.status);

  const rows = Array.from(byUser.values()).sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime());

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Accounts
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Feed accounts</h1>
        <p className="mt-1 text-sm text-zinc-400">
          One row per distinct user across feed signups, feed trials, and Black trials — the
          people currently in the feed pipeline, in any state.
        </p>
      </header>

      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Last activity</th>
                <th className="pb-2 pr-4">User</th>
                <th className="pb-2 pr-4">Sources</th>
                <th className="pb-2 pr-4">Latest status</th>
                <th className="pb-2">Account</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(r.latestAt)}{" "}
                    <span className="text-zinc-600">({formatRelative(r.latestAt)})</span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-200">
                    {r.userName ?? "—"}
                    <div className="text-xs text-zinc-500">{r.userEmail ?? "—"}</div>
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">
                    {r.sources.map((s) => SOURCE_LABEL[s]).join(", ")}
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{r.latestStatus}</td>
                  <td className="py-2">
                    <a
                      href={`https://portal.horizonhft.com/admin/users/${r.userId}`}
                      className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300"
                    >
                      View user
                    </a>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500">
                    No feed accounts yet.
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
