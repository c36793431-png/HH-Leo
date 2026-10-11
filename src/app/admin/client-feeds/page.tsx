import Link from "next/link";
import { listClientFeeds } from "@/lib/client-feeds";
import { FEED_REGIONS, FEED_REGION_LABELS, isFeedRegion } from "@/lib/feed-tier-catalogue";
import { ClientFeedsTable } from "@/components/admin/client-feeds-table";

/** Client feeds (marcus m63917 B2): every client's feed subscriptions in one read-only list, with the
 * server, the allowlist state and the end date, which no other admin page shows together. */
export const dynamic = "force-dynamic";

export default async function AdminClientFeedsPage({ searchParams }: { searchParams: Promise<{ region?: string }> }) {
  const sp = await searchParams;
  const region = sp.region && isFeedRegion(sp.region) ? sp.region : undefined;
  const rows = await listClientFeeds({ region });
  const pastEnd = rows.filter((r) => r.pastEndStillActive).length;

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Client feeds
        </span>
        <p className="mt-2 text-sm text-zinc-400">
          Every feed subscription: who holds it, on which server, until when, and whether the IP is open on the allowlist.
        </p>
        {pastEnd > 0 && (
          <p className="mt-2 text-sm text-amber-300">
            {pastEnd} past their end date and still active. Nothing ends these automatically: End them on the client&rsquo;s page
            and revoke the allowlist record.
          </p>
        )}
      </header>

      <form className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-4">
        <div>
          <label className="block text-xs text-zinc-500">Region</label>
          <select
            name="region"
            defaultValue={region ?? ""}
            className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
          >
            <option value="">All regions</option>
            {FEED_REGIONS.map((r) => (
              <option key={r} value={r}>
                {FEED_REGION_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-md bg-cyan-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-cyan-400">
          Filter
        </button>
        {region && (
          <Link href="/admin/client-feeds" className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline">
            Clear filter
          </Link>
        )}
      </form>

      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <ClientFeedsTable rows={rows} />
      </section>
    </div>
  );
}
