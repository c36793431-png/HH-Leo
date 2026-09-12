import Link from "next/link";
import { getProviderMarketplaceSummary, listAllLiveTiers } from "@/lib/provider-tiers";
import {
  listSubscribersByProvider,
  groupAccountSubscriptions,
  statusForGroup,
  regionKeyForGroup,
  resolvedPriceCentsFor,
  startedAtForGroup,
  statusReasonForGroup,
  buildMonthlyHistory,
  sumMonthlyGrossCents,
  sumProviderShareCents,
  pricedGroupCounts,
  type AccountRowGroup,
} from "@/lib/feed-subscriptions";
import { isUnpriced, moneyOrUnpriced, UNPRICED_LABEL } from "@/lib/feed-provider-packages";
import { FEED_REGIONS, FEED_REGION_LABELS, isFeedRegion, type FeedRegion } from "@/lib/feed-tier-catalogue";

// Revenue-split tab (Iris's spec §9, bus thread feed-admin-dashboard-build-2026-08-24), rebuilt
// 2026-09-12 per marcus m49045: coxwell, on /admin/revenue, "the revenue is totally missing so we
// are missing these payments as registered". It was missing because this page read provider_tiers
// ONLY, and that table has no rows -- while the money the marketplace actually contracted sits in
// feed_subscriptions. So the page now reads BOTH: the subscription-derived figures every provider
// Revenue page shows, summed across all providers, plus the provider_tiers per-tier table for the
// day that table is populated.
//
// EVERY FIGURE HERE COMES FROM THE FUNCTIONS THE PROVIDER'S OWN PAGE CALLS -- resolvedPriceCentsFor,
// sumMonthlyGrossCents, sumProviderShareCents, pricedGroupCounts, buildMonthlyHistory. No admin-only
// reimplementation of a price, a split or a month test, because the entire complaint this page
// answers was two surfaces disagreeing about the same money.

/** provider_tiers money, at cent precision -- the auditability the footnote promises. */
function fmtUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Subscription money, in the provider panel's own whole-dollar form. Deliberately a DIFFERENT
 * formatter from fmtUsd above: these figures must read identically to the number the provider sees
 * on their own Revenue page, and matching that matters more than matching the tier table below,
 * which has a separate source and a separate precision. */
function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function priceCell(cents: number | null): string {
  return isUnpriced(cents) ? UNPRICED_LABEL : money(cents);
}

/** "1 of 6 priced", or null when every paying client on the line has a price (C3, m49063). */
function pricedNote(priced: number, subscribers: number): string | null {
  return priced < subscribers ? `${priced} of ${subscribers} priced` : null;
}

/** A money cell that can be unknown (all its clients unpriced) or inapplicable (no paying client
 * at all). Same three-way distinction the provider page's totalCell draws. */
function totalCell(cents: number, priced: number, subscribers: number): string {
  return subscribers === 0 ? "—" : moneyOrUnpriced(cents, priced);
}

type ViewKey = "summary" | "clients" | "history";
type RegionFilter = FeedRegion | "all";

interface RawSearchParams {
  view?: string;
  region?: string;
}

function hrefFor(view: ViewKey, region: RegionFilter): string {
  const params = new URLSearchParams();
  if (view !== "summary") params.set("view", view);
  if (region !== "all") params.set("region", region);
  const qs = params.toString();
  return qs ? `/admin/revenue?${qs}` : "/admin/revenue";
}

/** One provider's line on this page. `groups` is already region-filtered and already has live
 * trials removed, so every figure below describes exactly the same client set. */
interface ProviderRollup {
  providerUserId: string;
  providerLabel: string;
  groups: AccountRowGroup[];
  payingCount: number;
  pricedCount: number;
  lapsedCount: number;
  grossCents: number;
  /** What the provider keeps. Horizon-retained is gross minus this, never a second halving. */
  providerShareCents: number;
}

function rollupFor(providerUserId: string, providerLabel: string, groups: AccountRowGroup[]): ProviderRollup {
  const counts = pricedGroupCounts(groups);
  return {
    providerUserId,
    providerLabel,
    groups,
    payingCount: counts.subscribers,
    pricedCount: counts.priced,
    lapsedCount: groups.filter((g) => statusForGroup(g) !== "active").length,
    grossCents: sumMonthlyGrossCents(groups),
    providerShareCents: sumProviderShareCents(groups),
  };
}

/** History across every provider, merged by month (marcus m49168: "reuse buildMonthlyHistory").
 *
 * buildMonthlyHistory is called PER PROVIDER and its output merged, never once over a pooled group
 * list -- pseudonyms are only unique within a provider, so pooling would weld two providers' clients
 * together. Merging sums each month's clients and money and concatenates the client lists; since
 * History counts priced clients only (m49171), `clients` and `pricedClients` agree provider by
 * provider and so do their sums.
 *
 * Months are still never summed across each other -- m49083's rule, and the reason this returns one
 * row per month with no grand total. */
interface AdminMonthEntry {
  monthKey: string;
  label: string;
  clients: number;
  grossCents: number;
  shareCents: number;
  rows: { key: string; provider: string; client: string; label: string; regionKey: string | null; priceCents: number | null; fromISO: string; toISO: string; open: boolean }[];
}

function buildAdminHistory(rollups: ProviderRollup[], now: Date): AdminMonthEntry[] {
  const byMonth = new Map<string, AdminMonthEntry>();
  for (const r of rollups) {
    for (const m of buildMonthlyHistory(r.groups, now)) {
      const entry = byMonth.get(m.monthKey) ?? {
        monthKey: m.monthKey,
        label: m.label,
        clients: 0,
        grossCents: 0,
        shareCents: 0,
        rows: [],
      };
      entry.clients += m.clients;
      entry.grossCents += m.grossCents;
      entry.shareCents += m.shareCents;
      for (const row of m.rows) {
        entry.rows.push({ ...row, key: `${r.providerUserId}-${row.key}`, provider: r.providerLabel });
      }
      byMonth.set(m.monthKey, entry);
    }
  }
  return [...byMonth.values()].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
}

export default async function AdminRevenuePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const view: ViewKey = sp.view === "clients" ? "clients" : sp.view === "history" ? "history" : "summary";

  const [summary, tiers, partitions] = await Promise.all([
    getProviderMarketplaceSummary(),
    listAllLiveTiers(),
    listSubscribersByProvider(),
  ]);

  /** Grouped per provider, then live trials dropped -- the same two steps, in the same order, as
   * the provider Revenue page (m49101: a live trial client is not on a money surface at all; an
   * EXPIRED trial licence is lapsed and does show, carrying its date). */
  const perProvider = partitions.map((p) => ({
    providerUserId: p.providerUserId,
    providerLabel: p.providerLabel,
    groups: groupAccountSubscriptions(p.rows).filter((g) => statusForGroup(g) !== "trial"),
  }));

  /** Region tabs are the union of the regions providers actually have groups in, in catalogue
   * order -- never a hardcoded list, so no tab is offered that would render empty. */
  const presentRegions = FEED_REGIONS.filter((r) =>
    perProvider.some((p) => p.groups.some((g) => regionKeyForGroup(g) === r))
  );
  const region: RegionFilter =
    sp.region && isFeedRegion(sp.region) && presentRegions.includes(sp.region) ? sp.region : "all";

  const rollups = perProvider
    .map((p) =>
      rollupFor(
        p.providerUserId,
        p.providerLabel,
        region === "all" ? p.groups : p.groups.filter((g) => regionKeyForGroup(g) === region)
      )
    )
    .filter((r) => r.groups.length > 0);

  const grossCents = rollups.reduce((sum, r) => sum + r.grossCents, 0);
  const providerPayoutCents = rollups.reduce((sum, r) => sum + r.providerShareCents, 0);
  const payingCount = rollups.reduce((sum, r) => sum + r.payingCount, 0);
  const pricedCount = rollups.reduce((sum, r) => sum + r.pricedCount, 0);
  const history = view === "history" ? buildAdminHistory(rollups, new Date()) : [];

  /** m49045: replace "No live tiers yet" with an empty state only when BOTH sources are empty.
   * provider_tiers having no rows is the ORIGINAL bug, not an empty state. */
  const empty = tiers.length === 0 && rollups.length === 0;

  const clientRows = rollups.flatMap((r) =>
    r.groups.map((g) => {
      const paying = statusForGroup(g) === "active";
      const regionKey = regionKeyForGroup(g);
      return {
        key: `${r.providerUserId}-${g.kind === "package" ? `${g.pseudonym}-${g.label}` : g.row.subscriptionId}`,
        provider: r.providerLabel,
        client: g.kind === "package" ? g.pseudonym : g.row.pseudonym,
        label: g.kind === "package" ? g.label : g.row.tierName,
        regionLabel: regionKey && isFeedRegion(regionKey) ? FEED_REGION_LABELS[regionKey] : "—",
        priceCents: paying ? resolvedPriceCentsFor(g) : null,
        sinceISO: startedAtForGroup(g).toISOString().slice(0, 10),
        reason: statusReasonForGroup(g),
      };
    })
  );

  const viewTabs: { key: ViewKey; label: string }[] = [
    { key: "summary", label: "Summarized" },
    { key: "clients", label: "Clients" },
    { key: "history", label: "History (contracted)" },
  ];
  const regionTabs: { key: RegionFilter; label: string }[] = [
    { key: "all", label: "All" },
    ...presentRegions.map((r) => ({ key: r as RegionFilter, label: FEED_REGION_LABELS[r] })),
  ];
  const tabClass = (on: boolean) =>
    `rounded border px-2.5 py-1 text-xs ${
      on ? "border-cyan-400/50 bg-cyan-950/30 text-cyan-300" : "border-zinc-700/50 text-zinc-400 hover:text-zinc-200"
    }`;

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-6">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Revenue · Run-rate
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Revenue split</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Contracted run-rate across every feed provider — price × split, not reconciled payments.
        </p>
      </header>

      {empty ? (
        <div className="mb-6 rounded-lg border border-zinc-700/50 bg-zinc-900/40 px-4 py-2.5 text-sm text-zinc-400">
          Nothing contracted yet — no provider has a priced subscription, and no provider tier is
          confirmed, so there is no run-rate to compute.
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {viewTabs.map((t) => (
              <Link key={t.key} href={hrefFor(t.key, region)} className={tabClass(view === t.key)}>
                {t.label}
              </Link>
            ))}
            {regionTabs.length > 1 && (
              <span className="ml-2 flex flex-wrap gap-2 border-l border-zinc-800 pl-3">
                {regionTabs.map((t) => (
                  <Link key={t.key} href={hrefFor(view, t.key)} className={tabClass(region === t.key)}>
                    {t.label}
                  </Link>
                ))}
              </span>
            )}
          </div>

          <section className="mb-6 rounded-xl border border-emerald-400/35 bg-emerald-950/20 p-6">
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              Horizon-retained run-rate / mo{region === "all" ? "" : ` · ${FEED_REGION_LABELS[region]}`}
            </div>
            <div className="mt-1 text-3xl font-semibold text-emerald-300">
              {totalCell(grossCents - providerPayoutCents, pricedCount, payingCount)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
              <span>
                Gross <span className="text-zinc-300">{totalCell(grossCents, pricedCount, payingCount)}</span>
              </span>
              <span>
                Provider payout{" "}
                <span className="text-zinc-300">{totalCell(providerPayoutCents, pricedCount, payingCount)}</span>
              </span>
              <span>
                Paying clients <span className="text-zinc-300">{payingCount}</span>
                {pricedNote(pricedCount, payingCount) && (
                  <span className="text-zinc-500"> · {pricedNote(pricedCount, payingCount)}</span>
                )}
              </span>
              {tiers.length > 0 && (
                <span>
                  provider_tiers run-rate{" "}
                  <span className="text-zinc-300">{fmtUsd(summary.retainedRunRateCents)}</span> retained
                </span>
              )}
            </div>
          </section>

          {view === "summary" && (
            <section className="mb-6 rounded-xl border border-zinc-700/50 bg-zinc-900/40 p-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-zinc-500">
                    <tr>
                      <th className="pb-2 pr-4">Provider</th>
                      <th className="pb-2 pr-4">Paying clients</th>
                      <th className="pb-2 pr-4">Monthly gross</th>
                      <th className="pb-2 pr-4">Provider payout</th>
                      <th className="pb-2">Retained</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {rollups.map((r) => (
                      <tr key={r.providerUserId}>
                        <td className="py-2 pr-4 text-zinc-200">
                          {r.providerLabel}
                          {r.lapsedCount > 0 && (
                            <div className="text-xs text-zinc-500">{r.lapsedCount} lapsed</div>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-zinc-300">
                          {r.payingCount}
                          {pricedNote(r.pricedCount, r.payingCount) && (
                            <div className="text-xs text-zinc-500">{pricedNote(r.pricedCount, r.payingCount)}</div>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-zinc-400">
                          {totalCell(r.grossCents, r.pricedCount, r.payingCount)}
                        </td>
                        <td className="py-2 pr-4 text-zinc-400">
                          {totalCell(r.providerShareCents, r.pricedCount, r.payingCount)}
                        </td>
                        <td className="py-2 text-emerald-300">
                          {totalCell(r.grossCents - r.providerShareCents, r.pricedCount, r.payingCount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {view === "clients" && (
            <section className="mb-6 rounded-xl border border-zinc-700/50 bg-zinc-900/40 p-4">
              <p className="mb-3 text-xs text-zinc-500">
                One row per client and package — the grain the price is written and resolved on, so
                adding the column up cannot triple a $30 client. Clients are shown by their
                per-provider pseudonym: providers never see subscriber identity, and this page does
                not widen that. Lapsed clients are listed with the reason they stopped and carry no
                money.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-zinc-500">
                    <tr>
                      <th className="pb-2 pr-4">Provider</th>
                      <th className="pb-2 pr-4">Client</th>
                      <th className="pb-2 pr-4">Package</th>
                      <th className="pb-2 pr-4">Region</th>
                      <th className="pb-2 pr-4">Monthly</th>
                      <th className="pb-2">Since</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {clientRows.map((c) => (
                      <tr key={c.key} className={c.reason ? "text-zinc-500" : undefined}>
                        <td className="py-2 pr-4">{c.provider}</td>
                        <td className="py-2 pr-4 font-mono text-zinc-200">
                          {c.client}
                          {c.reason && <div className="text-xs text-zinc-500">{c.reason}</div>}
                        </td>
                        <td className="py-2 pr-4 text-zinc-300">{c.label}</td>
                        <td className="py-2 pr-4 text-zinc-400">{c.regionLabel}</td>
                        <td className="py-2 pr-4 text-zinc-400">{c.reason ? "—" : priceCell(c.priceCents)}</td>
                        <td className="py-2 font-mono text-zinc-400">{c.sinceISO}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {view === "history" && (
            <section className="mb-6 rounded-xl border border-zinc-700/50 bg-zinc-900/40 p-4">
              <p className="mb-3 text-xs text-zinc-500">
                Newest month first. A client counts in a month if their subscription was live during
                it; the figures are that month&apos;s alone and are deliberately not totalled down the
                page, so a one-month term never reads as three months of revenue. Contracted periods,
                not payments received — there is no ledger.
              </p>
              {history.length === 0 ? (
                <p className="text-sm text-zinc-400">
                  {region === "all"
                    ? "A month appears here once a client held a priced subscription during it."
                    : `No client has held a priced subscription in ${FEED_REGION_LABELS[region]} in any month.`}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-zinc-500">
                      <tr>
                        <th className="pb-2 pr-4">Month</th>
                        <th className="pb-2 pr-4">Paying clients</th>
                        <th className="pb-2 pr-4">Monthly gross</th>
                        <th className="pb-2">Horizon 50%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {history.map((m) => (
                        <tr key={m.monthKey}>
                          <td className="py-2 pr-4 text-zinc-200">
                            {m.label}
                            {m.rows.length > 0 && (
                              <div className="text-xs text-zinc-500">
                                {m.rows
                                  .map((r) => `${r.client} ${r.label} ${priceCell(r.priceCents)} (${r.fromISO} → ${r.open ? "ongoing" : r.toISO})`)
                                  .join(" · ")}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-zinc-300">{m.clients}</td>
                          <td className="py-2 pr-4 text-zinc-400">
                            {m.clients === 0 ? "—" : money(m.grossCents)}
                          </td>
                          <td className="py-2 text-emerald-300">
                            {m.clients === 0 ? "—" : money(m.grossCents - m.shareCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tiers.length > 0 && (
            <section className="mb-6 rounded-xl border border-zinc-700/50 bg-zinc-900/40 p-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
                provider_tiers — self-serve marketplace tiers
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-zinc-500">
                    <tr>
                      <th className="pb-2 pr-4">Provider</th>
                      <th className="pb-2 pr-4">Tier</th>
                      <th className="pb-2 pr-4">Price</th>
                      <th className="pb-2 pr-4">Split</th>
                      <th className="pb-2 pr-4">Provider payout</th>
                      <th className="pb-2">Retained</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {tiers.map((t) => (
                      <tr key={t.id}>
                        <td className="py-2 pr-4 text-zinc-200">{t.providerName}</td>
                        <td className="py-2 pr-4 text-zinc-300">{t.tierName}</td>
                        <td className="py-2 pr-4 text-zinc-400">{fmtUsd(t.clientPriceCents)}</td>
                        <td className="py-2 pr-4 text-zinc-400">{t.providerSplitPct}%</td>
                        <td className="py-2 pr-4 text-zinc-400">{fmtUsd(t.providerPayoutCents)}</td>
                        <td className="py-2 text-emerald-300">{fmtUsd(t.retainedCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <p className="text-xs text-zinc-500">
        Contracted run-rate — price × split. <b>Not reconciled against payments received</b>; there is
        no payment ledger for feeds, so nothing here is evidence that money arrived. Subscription
        figures count paying clients only: live trials are excluded, and a client with no negotiated
        price reads &ldquo;{UNPRICED_LABEL}&rdquo; rather than $0. Software licence fees are not feed
        revenue and do not appear.
      </p>

      <div className="mt-6 text-sm">
        <Link href="/admin" className="text-cyan-400 hover:underline">
          ← Back to overview
        </Link>
      </div>
    </div>
  );
}
