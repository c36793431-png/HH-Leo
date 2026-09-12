import Link from "next/link";
import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { PackageRevenueRow } from "@/components/feed/package-revenue-rows";
import {
  listSubscribersForProvider,
  groupAccountSubscriptions,
  resolvedPriceCentsFor,
  lastPriceCentsFor,
  statusReasonForGroup,
  regionKeyForGroup,
  startedAtForGroup,
  statusForGroup,
  sumProviderShareCents,
  sumMonthlyGrossCents,
  pricedGroupCounts,
  type AccountRowGroup,
} from "@/lib/feed-subscriptions";
import { providerShareCentsFor, isUnpriced, moneyOrUnpriced, UNPRICED_LABEL } from "@/lib/feed-provider-packages";
import { FEED_REGIONS, FEED_REGION_LABELS, isFeedRegion, type FeedRegion } from "@/lib/feed-tier-catalogue";

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** coxwell 2026-09-12 21:18Z (marcus m49032): "Rows priced at 0 render the price as 'unpriced',
 * not '$0', so coxwell can see which London clients still carry no price". Both an absent price
 * (null -- never negotiated) and a stored 0 read as unpriced: nothing has ever been charged on
 * this platform, so a 0 in price_cents is a row the recut left unset, not a client who genuinely
 * pays nothing. Shipped on the Clients view first; marcus's C3 ruling (m49063) then extended it
 * to every provider surface, so the predicate now lives in feed-provider-packages.ts (isUnpriced)
 * and this page just renders it. The totals below still add a 0 as 0 -- only an all-unpriced
 * total changes shape (moneyOrUnpriced), so a column and its footer cannot disagree. */
function priceCell(cents: number | null): string {
  return isUnpriced(cents) ? UNPRICED_LABEL : money(cents);
}

/** The qualifier that goes beside a summed money figure when the clients behind it are not all
 * priced (marcus C3, m49063: "'6 subscribers, 1 priced, $30', so nobody divides $30 by 6").
 * Null when every paying client on the line has a price -- the common case stays a bare figure,
 * and the qualifier only appears where the division would actually mislead. */
function pricedNote(priced: number, subscribers: number): string | null {
  return priced < subscribers ? `${priced} of ${subscribers} priced` : null;
}

/** The Total row's money cells. `moneyOrUnpriced` alone answers "the clients behind this figure
 * have no price" with "unpriced" (C3, m49063) -- but under the Lapsed/All filter a region can now
 * render a full table with NO paying client in it at all (NY tonight), and "unpriced" there would
 * claim a missing price for clients that aren't being counted in the first place. No paying client
 * is "—", the same distinction the package lines draw. */
function totalCell(cents: number, priced: number, subscribers: number): string {
  return subscribers === 0 ? "—" : moneyOrUnpriced(cents, priced);
}

interface PackageRevenueGroup {
  key: string;
  label: string;
  memberTierNames: string[];
  subscriberCount: number;
  /** Of `subscriberCount`, how many carry a real price. Below it, "Monthly"/"Your 50%" describe
   * fewer clients than the Subscribers column counts, and the row says so (m49063). */
  pricedCount: number;
  monthlyCents: number;
  shareCents: number;
  /** Clients on this package who are NOT paying, counted but never priced (m49070). They exist so
   * the Lapsed/All filter can show a package at all when nobody on it is paying, and so a package
   * that lost five clients doesn't look identical to one that never had them. */
  lapsedCount: number;
  trialCount: number;
}

/** Job E, bus thread leo-provider-subscribers-page-2026-09-06 (marcus/coxwell): Revenue used
 * to be the Feeds catalogue with a price column bolted on -- every tier the provider manages,
 * whether or not anyone was paying for it. This is a MONEY view, driven by subscribers, not a
 * product view driven by the catalogue: a row exists only because at least one paying client
 * holds it, and "Monthly"/"Your 50%" are real per-client resolved prices
 * (resolvedPriceCentsFor/providerShareCentsFor -- the same functions Subscribers and the
 * Overview card call) summed across that package's paying clients, never the catalogue's $30
 * list price times a headcount. Only `status === "active"` groups count -- trial/lapsed
 * clients generate no revenue, same predicate as every other payout figure on this panel.
 *
 * C3 (marcus m49063) carries "unpriced" through this aggregation rather than leaving it at the
 * cell: a package line sums real prices over clients that may not all have one, so the group
 * also counts how many did. LD Base today is 6 paying clients but 1 priced, and "$30" against
 * "6" invites the reader to divide -- the row prints "1 of 6 priced" instead. A package where
 * NOTHING is priced carries monthlyCents 0, which is an unknown total, not a nil one, and
 * renders "unpriced" on both money columns.
 *
 * The Paying | Lapsed | All filter (m49070) does NOT change what the money columns mean here.
 * Every package line is walked whatever the filter, and only `status === "active"` groups ever
 * reach monthlyCents/shareCents/pricedCount -- non-paying clients are counted separately and
 * priced nowhere, so the by-package figures always describe exactly the same clients as the Total
 * row and as the Clients view. What the filter changes is which LINES are listed, and whether the
 * lapsed/trial counts are spelled out beside them. */
function buildPackageRevenueGroups(accountGroups: AccountRowGroup[]): PackageRevenueGroup[] {
  const byKey = new Map<string, PackageRevenueGroup>();

  for (const g of accountGroups) {
    const status = statusForGroup(g);
    const paying = status === "active";

    const priceCents = paying ? resolvedPriceCentsFor(g) : null;
    const monthlyCents = paying ? priceCents ?? 0 : 0;
    const shareCents = paying ? providerShareCentsFor(status, priceCents) ?? 0 : 0;
    const key = g.kind === "package" ? g.label : g.row.tierKey ?? g.row.tierName;
    const memberNames = g.kind === "package" ? g.members.map((m) => m.tierName) : [];

    const priced = paying && !isUnpriced(priceCents) ? 1 : 0;

    const existing = byKey.get(key);
    if (existing) {
      existing.subscriberCount += paying ? 1 : 0;
      existing.pricedCount += priced;
      existing.monthlyCents += monthlyCents;
      existing.shareCents += shareCents;
      existing.lapsedCount += status === "lapsed" ? 1 : 0;
      existing.trialCount += status === "trial" ? 1 : 0;
      for (const name of memberNames) {
        if (!existing.memberTierNames.includes(name)) existing.memberTierNames.push(name);
      }
    } else {
      byKey.set(key, {
        key,
        label: g.kind === "package" ? g.label : g.row.tierName,
        memberTierNames: memberNames,
        subscriberCount: paying ? 1 : 0,
        pricedCount: priced,
        monthlyCents,
        shareCents,
        lapsedCount: status === "lapsed" ? 1 : 0,
        trialCount: status === "trial" ? 1 : 0,
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
  /** Null for a paying client. Non-null is what greys the row and prints why they stopped
   * ("Licence expired 2026-09-09" / "Ended 2026-09-01" / "Trial") -- m49070, m49081. */
  reason: string | null;
  /** The last price a non-paying client carried, rendered as TEXT beside the reason and added to
   * nothing (m49070). Null on a paying row, where priceCents above is the live figure. */
  lastPriceCents: number | null;
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
    const paying = status === "active";
    const priceCents = paying ? resolvedPriceCentsFor(g) : null;
    const regionKey = regionKeyForGroup(g);
    rows.push({
      key: g.kind === "package" ? `${g.pseudonym}-${g.label}` : g.row.subscriptionId,
      client: g.kind === "package" ? g.pseudonym : g.row.pseudonym,
      label: g.kind === "package" ? g.label : g.row.tierName,
      memberTierNames: g.kind === "package" ? g.members.map((m) => m.tierName) : [],
      regionLabel: regionKey && isFeedRegion(regionKey) ? FEED_REGION_LABELS[regionKey] : "—",
      priceCents,
      shareCents: paying ? providerShareCentsFor(status, priceCents) : null,
      sinceISO: startedAtForGroup(g).toISOString().slice(0, 10),
      reason: statusReasonForGroup(g),
      lastPriceCents: paying ? null : lastPriceCentsFor(g),
    });
  }

  return rows;
}

type ViewKey = "summary" | "clients";
type RegionFilter = FeedRegion | "all";
/** coxwell 22:00Z via marcus m49070/m49081: "we had some 7 paying clients for LD base and none for
 * NY, how to show them in this list?". Paying is today's behaviour and stays the default -- a
 * revenue page opens on money that is live. "Lapsed" holds everyone who is NOT paying, trials
 * included (m49078 item 2 sends trial groups here with reason "Trial"), because the question being
 * answered is "where did my other clients go", and a client on a free trial and a client whose
 * licence expired are both answers to it. The reason text on each row is what keeps them apart. */
type StatusFilter = "paying" | "lapsed" | "all";

interface RawSearchParams {
  view?: string;
  region?: string;
  status?: string;
}

function hrefFor(view: ViewKey, region: RegionFilter, status: StatusFilter): string {
  const params = new URLSearchParams();
  if (view !== "summary") params.set("view", view);
  if (region !== "all") params.set("region", region);
  if (status !== "paying") params.set("status", status);
  const qs = params.toString();
  return qs ? `/feed/dashboard/revenue?${qs}` : "/feed/dashboard/revenue";
}

function isStatusFilter(v: string): v is StatusFilter {
  return v === "paying" || v === "lapsed" || v === "all";
}

/** "6 lapsed · 4 trial", or null when there are none -- the sub-line under a package label and the
 * clause in the scope note. Zero parts are dropped rather than printed as "0 trial". */
function notPayingNote(lapsed: number, trial: number): string | null {
  const parts = [lapsed > 0 ? `${lapsed} lapsed` : null, trial > 0 ? `${trial} trial` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export default async function FeedRevenuePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const view: ViewKey = sp.view === "clients" ? "clients" : "summary";
  const status: StatusFilter = sp.status && isStatusFilter(sp.status) ? sp.status : "paying";

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

  /** The status filter selects ROWS, never figures. Both tables below are built from
   * `visibleGroups`, but every money number on the page -- the package lines' Monthly/Your 50% and
   * the Total row alike -- is computed from groups whose status is "active", inside
   * buildPackageRevenueGroups and the sum functions. So switching to Lapsed or All lists more
   * clients and moves no figure at all, which is m49070's "they contribute NOTHING to totals in
   * any mode; totals always = paying only". */
  const visibleGroups =
    status === "all" ? groups : groups.filter((g) => (statusForGroup(g) === "active") === (status === "paying"));
  const packageGroups = buildPackageRevenueGroups(visibleGroups).filter((p) =>
    status === "paying" ? p.subscriberCount > 0 : status === "lapsed" ? p.lapsedCount + p.trialCount > 0 : true
  );
  const clientRows = buildClientRevenueRows(visibleGroups);
  const notPayingCounts = {
    lapsed: groups.filter((g) => statusForGroup(g) === "lapsed").length,
    trial: groups.filter((g) => statusForGroup(g) === "trial").length,
  };
  /** Per marcus's m46511/m46518/m46522 rulings (same summation everywhere): both totals below
   * are the identical functions Subscribers' footer and the Overview card call, on the same
   * groups this page already grouped -- never a second reduce over the by-package or per-client
   * rows above, gross or split. They foot the CURRENTLY FILTERED region (m49032 item 3: "totals
   * recompute per region"); the Overview tile keeps calling getProviderMonthlyShareCents, which
   * is all regions, so the two agree exactly when this page is on All. */
  const totalMonthlyCents = sumMonthlyGrossCents(groups);
  const totalShareCents = sumProviderShareCents(groups);
  /** C3 (m49063): the same count qualifier the package rows carry, for the footer. Both views
   * foot the identical group set, so one call serves both tables. */
  const totalCounts = pricedGroupCounts(groups);

  const regionTabs: { key: RegionFilter; label: string }[] = [
    { key: "all", label: "All" },
    ...presentRegions.map((r) => ({ key: r as RegionFilter, label: FEED_REGION_LABELS[r] })),
  ];
  const statusTabs: { key: StatusFilter; label: string }[] = [
    { key: "paying", label: "Paying" },
    { key: "lapsed", label: "Lapsed" },
    { key: "all", label: "All" },
  ];
  const notPayingClause = notPayingNote(notPayingCounts.lapsed, notPayingCounts.trial);

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
                <Link href={hrefFor("summary", region, status)} className={view === "summary" ? "on" : ""}>
                  Summarized
                </Link>
                <Link href={hrefFor("clients", region, status)} className={view === "clients" ? "on" : ""}>
                  Clients
                </Link>
              </div>
              {regionTabs.length > 1 && (
                <div className="seg">
                  {regionTabs.map((t) => (
                    <Link key={t.key} href={hrefFor(view, t.key, status)} className={region === t.key ? "on" : ""}>
                      {t.label}
                    </Link>
                  ))}
                </div>
              )}
              <div className="seg">
                {statusTabs.map((t) => (
                  <Link key={t.key} href={hrefFor(view, region, t.key)} className={status === t.key ? "on" : ""}>
                    {t.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* m49070: "Scope note line updates to name the filter." The second sentence is the one
              that must never change with the filter -- whichever rows are on screen, the money is
              the paying ones', so a reader who switches to Lapsed and sees the same $30 knows why. */}
          <div className="scope-note">
            <span className="i">◈</span>
            <span>
              {region === "all" ? "All regions" : FEED_REGION_LABELS[region]} ·{" "}
              {status === "paying"
                ? "paying subscribers only"
                : status === "lapsed"
                  ? "lapsed and trial clients only"
                  : "all clients, paying or not"}
              {status !== "paying" && notPayingClause ? ` (${notPayingClause})` : ""} — every figure on this page
              counts paying clients only; a lapsed or trial client adds nothing to any total in any view.
            </span>
          </div>

          {view === "clients" ? (
            clientRows.length === 0 ? (
              <div className="empty">
                <div className="eic">◈</div>
                <b>{status === "paying" ? "No paying clients here" : "No clients here"}</b>
                <p>
                  {status === "paying"
                    ? region === "all"
                      ? "A client appears once they hold an active, paid subscription to one of your tiers."
                      : `No client holds an active subscription in ${FEED_REGION_LABELS[region]}.`
                    : status === "lapsed"
                      ? "No client here has lapsed or is on a trial licence."
                      : "No client holds a subscription to one of your tiers here."}
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
                  {/* A non-paying row is greyed, says why under the client, and prints its last
                      price as text in the Monthly column with no share beside it -- never a money
                      cell, because it is not money anyone is owed (m49070). */}
                  {clientRows.map((r) => (
                    <tr key={r.key} className={r.reason ? "not-paying" : undefined}>
                      <td>
                        <b className="mono">{r.client}</b>
                        {r.reason && <div className="sub muted">{r.reason}</div>}
                      </td>
                      <td>
                        <b>{r.label}</b>
                        {r.memberTierNames.length > 0 && <div className="sub">{r.memberTierNames.join(" · ")}</div>}
                      </td>
                      <td>{r.regionLabel}</td>
                      <td className="r">
                        {r.reason ? (
                          <span className="last-price">
                            {isUnpriced(r.lastPriceCents) ? UNPRICED_LABEL : `last ${money(r.lastPriceCents)}`}
                          </span>
                        ) : (
                          <span className="mono">{priceCell(r.priceCents)}</span>
                        )}
                      </td>
                      <td className="r share">
                        {r.reason ? "—" : r.shareCents == null ? UNPRICED_LABEL : money(r.shareCents)}
                      </td>
                      <td className="r mono">{r.sinceISO}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={3} className="r">
                      <b>Total</b>
                      <div className="sub">paying clients only</div>
                    </td>
                    <td className="r mono">
                      <b>{totalCell(totalMonthlyCents, totalCounts.priced, totalCounts.subscribers)}</b>
                      {pricedNote(totalCounts.priced, totalCounts.subscribers) && (
                        <div className="sub">{pricedNote(totalCounts.priced, totalCounts.subscribers)}</div>
                      )}
                    </td>
                    <td className="r share">
                      <b>{totalCell(totalShareCents, totalCounts.priced, totalCounts.subscribers)}</b>
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            )
          ) : packageGroups.length === 0 ? (
            <div className="empty">
              <div className="eic">◈</div>
              <b>{status === "paying" ? "No paying subscribers yet" : "Nothing to show here"}</b>
              <p>
                {status === "paying"
                  ? "Revenue by package appears here once a client holds an active, paid subscription."
                  : status === "lapsed"
                    ? "No package here has a lapsed or trial client."
                    : "No package here has a client of any kind."}
              </p>
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
                    pricedNote={pricedNote(g.pricedCount, g.subscriberCount)}
                    notPayingNote={status === "paying" ? null : notPayingNote(g.lapsedCount, g.trialCount)}
                    /* A package with nobody paying on it has no unknown price to report -- it has
                       no price at all, so the money cells read "—" rather than "unpriced", which
                       would imply a client whose figure is merely missing. */
                    monthlyLabel={g.subscriberCount === 0 ? "—" : moneyOrUnpriced(g.monthlyCents, g.pricedCount)}
                    shareLabel={g.subscriberCount === 0 ? "—" : moneyOrUnpriced(g.shareCents, g.pricedCount)}
                  />
                ))}
                <tr className="total-row">
                  <td className="r">
                    <b>Total</b>
                    <div className="sub">paying clients only</div>
                  </td>
                  <td className="r" />
                  <td className="r mono">
                    <b>{totalCell(totalMonthlyCents, totalCounts.priced, totalCounts.subscribers)}</b>
                    {pricedNote(totalCounts.priced, totalCounts.subscribers) && (
                      <div className="sub">{pricedNote(totalCounts.priced, totalCounts.subscribers)}</div>
                    )}
                  </td>
                  <td className="r share">
                    <b>{totalCell(totalShareCents, totalCounts.priced, totalCounts.subscribers)}</b>
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
