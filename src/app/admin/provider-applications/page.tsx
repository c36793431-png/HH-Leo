import Link from "next/link";
import {
  getProviderApplicationStats,
  listProviderApplications,
  type ProviderApplicationRow,
} from "@/lib/provider-applications";
import { getProviderMarketplaceSummary } from "@/lib/provider-tiers";
import { formatRelative } from "@/lib/format-time";
import { ProviderApplicationRowActions } from "@/components/admin/provider-application-row-actions";
import { approveProviderApplicationAction, declineProviderApplicationAction } from "./actions";

const STATUS_SEGMENTS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "declined", label: "Declined" },
  { key: "all", label: "All" },
] as const;

const STATUS_BADGE_STYLES: Record<ProviderApplicationRow["status"], string> = {
  pending: "border-amber-500/40 bg-amber-950/20 text-amber-300",
  approved: "border-emerald-500/40 bg-emerald-950/20 text-emerald-300",
  declined: "border-red-500/40 bg-red-950/20 text-red-300",
};

/** "protocol · regions · assets · N tiers" summary line -- self-reported at application time,
 * not the confirmed provider_tiers rows (those don't exist until registration). tiersOffered
 * is free text (one line/segment per tier per the apply form's hint), so the tier count here
 * is a best-effort split, not an exact figure. */
function feedTagStrip(a: ProviderApplicationRow): string {
  const parts = [a.protocol, a.regions, a.coverage].filter((v): v is string => Boolean(v && v.trim()));
  const tierCount = a.tiersOffered
    ? a.tiersOffered.split(/[\n;]/).map((s) => s.trim()).filter(Boolean).length
    : 0;
  if (tierCount > 0) parts.push(`${tierCount} tier${tierCount === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" · ") : "No feed details provided yet";
}

export default async function AdminProviderApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status: statusParam, q } = await searchParams;
  const status = STATUS_SEGMENTS.some((s) => s.key === statusParam) ? statusParam! : "pending";
  const search = q?.trim() || undefined;

  const [stats, marketplace, applications, approved] = await Promise.all([
    getProviderApplicationStats(),
    getProviderMarketplaceSummary(),
    listProviderApplications({ status: status === "all" ? undefined : (status as "pending" | "approved" | "declined"), search }),
    listProviderApplications({ status: "approved" }),
  ]);
  const pendingOnboarding = approved.filter((a) => !a.onboardedAt);

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Provider applications
        </span>
        <h1 className="mt-2 text-lg font-medium text-teal-400">Provider applications</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Feed provider signups from feed.horizonhft.com/providers/apply, pending review.
        </p>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="text-[11px] uppercase tracking-wide text-amber-400/80">Awaiting review</div>
          <div className="mt-1 text-2xl font-medium text-zinc-100">{stats.pendingCount}</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="text-[11px] uppercase tracking-wide text-emerald-400/80">Approved</div>
          <div className="mt-1 text-2xl font-medium text-zinc-100">{stats.approvedCount}</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="text-[11px] uppercase tracking-wide text-red-400/80">Declined</div>
          <div className="mt-1 text-2xl font-medium text-zinc-100">{stats.declinedCount}</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="text-[11px] uppercase tracking-wide text-cyan-400/80">Providers live</div>
          <div className="mt-1 text-2xl font-medium text-zinc-100">{marketplace.liveProviderCount}</div>
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 border-b border-zinc-800 text-sm">
          {STATUS_SEGMENTS.map((seg) => (
            <Link
              key={seg.key}
              href={`/admin/provider-applications?status=${seg.key}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
              className={`border-b-2 px-3 py-2 ${
                status === seg.key
                  ? "border-teal-400 text-teal-300"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {seg.label}
            </Link>
          ))}
        </div>

        <form className="flex items-center gap-2">
          <input type="hidden" name="status" value={status} />
          <input
            type="text"
            name="q"
            defaultValue={search ?? ""}
            placeholder="Search company or email…"
            className="rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600"
          />
          <button
            type="submit"
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Search
          </button>
          {search && (
            <Link
              href={`/admin/provider-applications?status=${status}`}
              className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline"
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      <section className="flex flex-col gap-3">
        {applications.map((a) => (
          <div
            key={a.id}
            className={`rounded-xl border-l-4 border border-zinc-800 bg-zinc-900/40 p-4 ${
              a.status === "pending" ? "border-l-amber-500" : "border-l-zinc-800"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Link
                  href={`/admin/provider-applications/${a.id}`}
                  className="text-sm font-medium text-teal-400 hover:underline"
                >
                  {a.name}
                </Link>
                {a.source === "admin_manual" && (
                  <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                    Manual
                  </span>
                )}
                <div className="mt-0.5 text-xs text-zinc-400">{a.email}</div>
                <div className="mt-1.5 text-[11px] text-zinc-500">{feedTagStrip(a)}</div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE_STYLES[a.status]}`}
                >
                  {a.status}
                </span>
                <span className="text-xs text-zinc-500">{formatRelative(a.appliedAt)}</span>
                {a.status === "pending" && (
                  <ProviderApplicationRowActions
                    applicationId={a.id}
                    approveAction={approveProviderApplicationAction}
                    declineAction={declineProviderApplicationAction}
                  />
                )}
              </div>
            </div>
          </div>
        ))}

        {applications.length === 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
            No {status === "all" ? "" : status} applications{search ? ` matching "${search}"` : ""}.
          </div>
        )}
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
