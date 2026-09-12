import Link from "next/link";
import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { PackageRevenueRow } from "@/components/feed/package-revenue-rows";
import {
  listSubscribersForProvider,
  groupAccountSubscriptions,
  resolvedPriceCentsFor,
  regionKeyForGroup,
  startedAtForGroup,
  statusForGroup,
  sumProviderShareCents,
  sumMonthlyGrossCents,
  type AccountRowGroup,
} from "@/lib/feed-subscriptions";
import { providerShareCentsFor } from "@/lib/feed-provider-packages";
import { FEED_REGIONS, FEED_REGION_LABELS, isFeedRegion, type FeedRegion } from "@/lib/feed-tier-catalogue";

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** coxwell 2026-09-12 21:18Z (marcus m49032): "Rows priced at 0 render the price as 'unpriced',
 * not '$0', so coxwell can see which London clients still carry no price". Both an absent price
 * (null -- never negotiated, what providerShareFor calls "Not set") and a stored 0 read as
 * unpriced here: nothing has ever been charged on this platform, so a 0 in price_cents is a
 * row the recut left unset, not a client who genuinely pays nothing. This collapses a
 * distinction the Subscribers page keeps (m46504) and it is deliberate on THIS view only --
 * the totals below still add a 0 as 0, so the column and the footer cannot disagree. */
const UNPRICED = "unpriced";
function priceCell(cents: number | null): string {
  return cents == null || cents === 0 ? UNPRICED : money(cents);
}

interface PackageRevenueGroup {
  key: string;
  label: string;
  memberTierNames: string[];
  subscriberCount: number;
  monthlyCents: number;
  shareCents: number;
}

/** Job E, bus thread leo-provider-subscribers-page-2026-09-06 (marcus/coxwell): Revenue used
 * to be the Feeds catalogue with a price column bolted on -- every tier the provider manages,
 * whether or not anyone was paying for it. This is a MONEY view, driven by subscribers, not a
 * product view driven by the catalogue: a row exists only because at least one paying client
 * holds it, and "Monthly"/"Your 50%" are real per-client resolved prices
 * (resolvedPriceCentsFor/providerShareCentsFor -- the same functions Subscribers and the
 * Overview card call) summed across that package's paying clients, never the catalogue's $30
 * list price times a headcount. Only `status === "active"` groups count -- trial/lapsed
 * clients generate no revenue, same predicate as every other payout figure on this panel. */
function buildPackageRevenueGroups(accountGroups: AccountRowGroup[]): PackageRevenueGroup[] {
  const byKey = new Map<string, PackageRevenueGroup>();

  for (const g of accountGroups) {
    const status = statusForGroup(g);
    if (status !== "active") continue;

    const priceCents = resolvedPriceCentsFor(g);
    const monthlyCents = priceCents ?? 0;
    const shareCents = providerShareCentsFor(status, priceCents) ?? 0;
    const key = g.kind === "package" ? g.label : g.row.tierKey ?? g.row.tierName;
    const memberNames = g.kind === "package" ? g.members.map((m) => m.tierName) : [];

    const existing = byKey.get(key);
    if (existing) {
      existing.subscriberCount += 1;
      existing.monthlyCents += monthlyCents;
      existing.shareCents += shareCents;
      for (const name of memberNames) {
        if (!existing.memberTierNames.includes(name)) existing.memberTierNames.push(name);
      }
    } else {
      byKey.set(key, {
        key,
        label: g.kind === "package" ? g.label : g.row.tierName,
        memberTierNames: memberNames,
        subscriberCount: 1,
        monthlyCents,
        shareCents,
      });
    }
  }

  return Array.from(byKey.values());
}

interface ClientRevenueRow {
  key: string;
  client: string;
  label: string;
  memberTierNames: string[];
  regionLabel: string;
  priceCents: number | null;
  shareCents: number | null;
  sinceISO: string;
}

/** The Clients view, coxwell 2026-09-12 21:18Z via marcus m49032: "it should show like the list
 * of clients purchase the feeds with also ability to change between region and summarized".
 *
 * GRAIN -- one row per (client, package), i.e. exactly the AccountRowGroup the money already
 * lives on, NOT one row per feed_subscriptions row. A price is written per package
 * (setFeedSubscriptionPriceForPackage fans one value across every member tier) and resolved per
 * package (resolvedPriceCentsFor), so a per-tier list would print the same $30 on LD Base's
 * three lines and a reader adding the column up would get $90 for a $30 client -- the same class
 * of error as the members[0]-off-the-catalogue bug Job C fixed. Member tiers stay visible as
 * detail on the row instead.
 *
 * IDENTITY -- the client column is the per-provider pseudonym (HH1, HH2, ...), which is what
 * "the same visibility set as the Subscribers page uses" means: listSubscribersForProvider
 * deliberately never selects email, display_name, or subscriber_user_id, because a provider who
 * can see real names can approach subscribers directly at renewal and cut Horizon out (migration
 * 0071, coxwell's 2026-08-29 ruling). m49032 asked for "client (email, or display name if
 * present)"; that reverses a recorded ruling and leaks client PII to every third-party provider,
 * so it is NOT shipped here -- escalated to marcus in the same report as a one-line change if
 * coxwell rules the other way. */
function buildClientRevenueRows(accountGroups: AccountRowGroup[]): ClientRevenueRow[] {
  const rows: ClientRevenueRow[] = [];

  for (const g of accountGroups) {
    const status = statusForGroup(g);
    if (status !== "active") continue;

    const priceCents = resolvedPriceCentsFor(g);
    const regionKey = regionKeyForGroup(g);
    rows.push({
      key: g.kind === "package" ? `${g.pseudonym}-${g.label}` : g.row.subscriptionId,
      client: g.kind === "package" ? g.pseudonym : g.row.pseudonym,
      label: g.kind === "package" ? g.label : g.row.tierName,
      memberTierNames: g.kind === "package" ? g.members.map((m) => m.tierName) : [],
      regionLabel: regionKey && isFeedRegion(regionKey) ? FEED_REGION_LABELS[regionKey] : "—",
      priceCents,
      shareCents: providerShareCentsFor(status, priceCents),
      sinceISO: startedAtForGroup(g).toISOString().slice(0, 10),
    });
  }

  return rows;
}

type ViewKey = "summary" | "clients";
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
  return qs ? `/feed/dashboard/revenue?${qs}` : "/feed/dashboard/revenue";
}

export default async function FeedRevenuePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const view: ViewKey = sp.view === "clients" ? "clients" : "summary";

  const session = await auth();
  const subscribers = await listSubscribersForProvider(session!.user!.id!);
  const allGroups = groupAccountSubscriptions(subscribers);

  /** m49032 item 3 asks for "All · London · NY ... add CME only if a row for it can exist
   * today", so the tabs are derived from the provider's own rows rather than hardcoded: a
   * region appears once this provider has a group in it, in the catalogue's own order. That
   * satisfies the CME carve-out without a second region list to keep in sync, and never offers
   * a tab that would render empty. */
  const presentRegions = FEED_REGIONS.filter((r) => allGroups.some((g) => regionKeyForGroup(g) === r));
  const region: RegionFilter = sp.region && isFeedRegion(sp.region) && presentRegions.includes(sp.region) ? sp.region : "all";
  const groups = region === "all" ? allGroups : allGroups.filter((g) => regionKeyForGroup(g) === region);

  const packageGroups = buildPackageRevenueGroups(groups);
  const clientRows = buildClientRevenueRows(groups);
  /** Per marcus's m46511/m46518/m46522 rulings (same summation everywhere): both totals below
   * are the identical functions Subscribers' footer and the Overview card call, on the same
   * groups this page already grouped -- never a second reduce over the by-package or per-client
   * rows above, gross or split. They foot the CURRENTLY FILTERED region (m49032 item 3: "totals
   * recompute per region"); the Overview tile keeps calling getProviderMonthlyShareCents, which
   * is all regions, so the two agree exactly when this page is on All. */
  const totalMonthlyCents = sumMonthlyGrossCents(groups);
  const totalShareCents = sumProviderShareCents(groups);

  const regionTabs: { key: RegionFilter; label: string }[] = [
    { key: "all", label: "All" },
    ...presentRegions.map((r) => ({ key: r as RegionFilter, label: FEED_REGION_LABELS[r] })),
  ];

  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>Revenue</h1>
          <div className="crumb">feed.horizonhft.com / revenue</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        <div className="banner info">
          <span className="bic">▦</span>
          <div>
            <b>No payout ledger yet</b> — nothing has ever been charged, so the figures below are an estimate
            from each client&apos;s own price, not a reconciled payment or money actually collected. Payout
            history and next-payout date are static preview copy.
          </div>
        </div>

        <div className="card full">
          <div className="chead">
            <span className="ic">◈</span>
            <h3>{view === "clients" ? "Clients" : "By package"}</h3>
            <div className="chead-tools">
              <div className="seg">
                <Link href={hrefFor("summary", region)} className={view === "summary" ? "on" : ""}>
                  Summarized
                </Link>
                <Link href={hrefFor("clients", region)} className={view === "clients" ? "on" : ""}>
                  Clients
                </Link>
              </div>
              {regionTabs.length > 1 && (
                <div className="seg">
                  {regionTabs.map((t) => (
                    <Link key={t.key} href={hrefFor(view, t.key)} className={region === t.key ? "on" : ""}>
                      {t.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="scope-note">
            <span className="i">◈</span>
            <span>
              {region === "all" ? "All regions" : FEED_REGION_LABELS[region]} · paying subscribers only — trial and
              lapsed clients are excluded from every figure on this page.
            </span>
          </div>

          {view === "clients" ? (
            clientRows.length === 0 ? (
              <div className="empty">
                <div className="eic">◈</div>
                <b>No paying clients here</b>
                <p>
                  {region === "all"
                    ? "A client appears once they hold an active, paid subscription to one of your tiers."
                    : `No client holds an active subscription in ${FEED_REGION_LABELS[region]}.`}
                </p>
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Package</th>
                    <th>Region</th>
                    <th className="r">Monthly</th>
                    <th className="r">Your 50%</th>
                    <th className="r">Since</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="note-row">
                    <td colSpan={6} className="r">
                      Clients are per-provider pseudonyms — Horizon never surfaces a subscriber&apos;s name or email.
                      &ldquo;Since&rdquo; is the earliest grant date on the row, not a purchase or payment history.
                    </td>
                  </tr>
                  {clientRows.map((r) => (
                    <tr key={r.key}>
                      <td>
                        <b className="mono">{r.client}</b>
                      </td>
                      <td>
                        <b>{r.label}</b>
                        {r.memberTierNames.length > 0 && <div className="sub">{r.memberTierNames.join(" · ")}</div>}
                      </td>
                      <td>{r.regionLabel}</td>
                      <td className="r mono">{priceCell(r.priceCents)}</td>
                      <td className="r share">{r.priceCents == null || r.priceCents === 0 ? "—" : money(r.shareCents ?? 0)}</td>
                      <td className="r mono">{r.sinceISO}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={3} className="r">
                      <b>Total</b>
                    </td>
                    <td className="r mono">
                      <b>{money(totalMonthlyCents)}</b>
                    </td>
                    <td className="r share">
                      <b>{money(totalShareCents)}</b>
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            )
          ) : packageGroups.length === 0 ? (
            <div className="empty">
              <div className="eic">◈</div>
              <b>No paying subscribers yet</b>
              <p>Revenue by package appears here once a client holds an active, paid subscription.</p>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Package</th>
                  <th className="r">Subscribers</th>
                  <th className="r">Monthly</th>
                  <th className="r">Your 50%</th>
                </tr>
              </thead>
              <tbody>
                {packageGroups.map((g) => (
                  <PackageRevenueRow
                    key={g.key}
                    label={g.label}
                    memberTierNames={g.memberTierNames}
                    subscriberCount={g.subscriberCount}
                    monthlyCents={g.monthlyCents}
                    shareCents={g.shareCents}
                  />
                ))}
                <tr className="total-row">
                  <td className="r">
                    <b>Total</b>
                  </td>
                  <td className="r" />
                  <td className="r mono">
                    <b>{money(totalMonthlyCents)}</b>
                  </td>
                  <td className="r share">
                    <b>{money(totalShareCents)}</b>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="foot">HORIZON HFT · provider panel · Revenue</div>
      </section>
    </>
  );
}
