import { Fragment } from "react";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { AccountPackageRows } from "@/components/feed/account-package-rows";
import {
  listSubscribersForProvider,
  groupAccountSubscriptions,
  resolvedPriceCentsFor,
  lastPriceCentsFor,
  statusReasonForGroup,
  statusEndedAtForGroup,
  startedAtForGroup,
  statusForGroup,
  sumProviderShareCents,
  pricedGroupCounts,
  countUnpseudonymedRowsForProvider,
  type AccountRowGroup,
  type ProviderSubscriberRow,
} from "@/lib/feed-subscriptions";
import { providerShareFor, isUnpriced, moneyOrUnpriced, UNPRICED_LABEL } from "@/lib/feed-provider-packages";
import { FEED_REGION_LABELS, isFeedRegion } from "@/lib/feed-tier-catalogue";

const STATUS_ICON: Record<string, string> = { trial: "🧪", active: "✓", lapsed: "✗" };
const OTHER_LOCATION = "Other";

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Bus thread leo-provider-panel-package-labels-2026-09-04 (marcus, follow-up A): since the
 * Job 2/3 regroup, one status count can mean either "N feeds" or "N clients" depending on
 * whether any client in that status holds more than one tier -- the two read the same before
 * grouping existed. Rather than silently pick a unit, show the feed count (unchanged) and only
 * add the client count when it actually differs from it, so the common case stays a single
 * plain number and only the ambiguous case grows a qualifier. */
function countLabel(feeds: number, clients: number, word: string): string {
  if (feeds === 0) return `0 ${word}`;
  if (feeds === clients) return `${feeds} ${word}`;
  return `${clients} ${word} client${clients === 1 ? "" : "s"} · ${feeds} feeds`;
}

/** Bus thread leo-provider-panel-package-labels-2026-09-05 (marcus, finding 3): countLabel's
 * bare-number shortcut (feeds === clients) reads fine standalone in the header cap, but "By
 * location" packs several of these into one sentence with no header nearby to disambiguate --
 * a bare "1 paying" there could mean 1 client or 1 feed. Always spell both nouns in that
 * context, and (unlike countLabel's hardcoded plural "feeds") pluralize correctly since a
 * single location can land on exactly 1 feed. */
function locationCountLabel(feeds: number, clients: number, word: string): string {
  return `${clients} ${word} client${clients === 1 ? "" : "s"} · ${feeds} feed${feeds === 1 ? "" : "s"}`;
}

/** coxwell 22:20Z via marcus m49101, looking at this page's header ("2 PAYING CLIENTS · 6 FEEDS ·
 * $15/MO · 4 TRIAL CLIENTS · 12 FEEDS · 8 LAPSED CLIENTS · 25 FEEDS"): "also need buttons to
 * navigate via these". So the header counts ARE the filter -- the same three numbers, now
 * clickable, plus All. Default is All because this page is the roster, not the money (Revenue
 * defaults to Paying for the opposite reason). Search-param driven so a filtered roster is a
 * link somebody can send. */
type SubscriberFilter = "all" | "paying" | "trial" | "lapsed";

const FILTER_STATUS: Record<Exclude<SubscriberFilter, "all">, ProviderSubscriberRow["status"]> = {
  paying: "active",
  trial: "trial",
  lapsed: "lapsed",
};

function isSubscriberFilter(v: string): v is SubscriberFilter {
  return v === "all" || v === "paying" || v === "trial" || v === "lapsed";
}

function hrefFor(filter: SubscriberFilter): string {
  return filter === "all" ? "/feed/dashboard/subscribers" : `/feed/dashboard/subscribers?status=${filter}`;
}

/** The rows behind a group, for the counts and the "By location" line -- both of which are per
 * FEED, while the table and the filter are per (client, package) group. Going through the group
 * rather than filtering the flat row list is what keeps the two units consistent under a filter:
 * a group's status is the ruled one (statusForPackageMembers), so a package whose members disagree
 * is counted under the one status its row on screen actually shows. */
function rowsOf(group: AccountRowGroup): ProviderSubscriberRow[] {
  return group.kind === "package" ? group.members : [group.row];
}

function pseudonymOf(group: AccountRowGroup): string {
  return group.kind === "package" ? group.pseudonym : group.row.pseudonym;
}

/** Counts for a set of groups, in the page's two units at once: FEEDS (rows) and CLIENTS (distinct
 * pseudonyms). One helper so the filter buttons and the section heads below cannot drift apart. */
function countsOf(groups: AccountRowGroup[]): { feeds: number; clients: number } {
  return {
    feeds: groups.reduce((n, g) => n + rowsOf(g).length, 0),
    clients: new Set(groups.map(pseudonymOf)).size,
  };
}

/** The noun each status is called on this page -- 'active' is spelled "paying" everywhere a human
 * reads it (the header cap, the buttons, the by-location line), and a section head must not be the
 * one place that reverts to the column value. */
const STATUS_WORD: Record<ProviderSubscriberRow["status"], string> = {
  active: "paying",
  trial: "trial",
  lapsed: "lapsed",
};

/** coxwell 21:49Z via marcus m49058, looking at this page: "how can the lapsed, active be organised
 * better, now we have just 2 clients which is not the case, was more" -- the roster ran the live and
 * the finished clients together in one undifferentiated list, so a provider scanning it had to read
 * every status badge to find out who is still with them. Two sections, each with its own counts.
 *
 * A LIVE TRIAL SITS UNDER ACTIVE. m49058 names two sections, and a trial client is a current client
 * -- they are on the feed today. The row keeps its own 'trial' badge and its "Trial" sub-line, and
 * the section head spells the split ("3 paying clients - 9 feeds; 2 trial clients - 6 feeds") rather
 * than letting one "5 active clients" imply five paying ones. Money is untouched by any of this:
 * the footer and the header cap are paying-only under every filter, as ruled (m49107). */
const SECTIONS = [
  { key: "active", label: "Active", statuses: ["active", "trial"] as ProviderSubscriberRow["status"][] },
  { key: "lapsed", label: "Lapsed", statuses: ["lapsed"] as ProviderSubscriberRow["status"][] },
] as const;

/** Within Active, newest grant first (m49058: "sort by started_at desc"), which puts a client who
 * arrived this week at the top where a provider looks for them.
 *
 * Within Lapsed the equivalent is most-recently-ended first, ordered by statusEndedAtForGroup --
 * the very date each of those rows prints in its sub-line, so the order can never contradict the
 * dates on screen. A lapsed group with NO date (nothing recorded an end anywhere) sorts last rather
 * than first: an unknown end is not a recent one. Both orders tie-break on the pseudonym so the
 * sequence is total and a reload cannot reshuffle two rows that share a date. */
function orderGroups(sectionKey: (typeof SECTIONS)[number]["key"], groups: AccountRowGroup[]): AccountRowGroup[] {
  const dateFor = (g: AccountRowGroup): number | null => {
    if (sectionKey === "active") return startedAtForGroup(g).getTime();
    const ended = statusEndedAtForGroup(g);
    return ended == null ? null : ended.getTime();
  };
  return [...groups].sort((a, b) => {
    const da = dateFor(a);
    const db = dateFor(b);
    if (da !== db) {
      if (da == null) return 1;
      if (db == null) return -1;
      return db - da;
    }
    return pseudonymOf(a).localeCompare(pseudonymOf(b));
  });
}

/** The grey line under a non-paying client's status badge: why they stopped (the SAME
 * statusReasonForGroup the Revenue page prints -- one wording, one place) and what they were last
 * on. The price sits here as text rather than in the "Your 50%*" column, because that column is a
 * payout share: a lapsed client's old gross price is neither a share nor money owed, and putting
 * it there would put a number nobody is paying into the one column a provider reads as income. */
function reasonLine(group: AccountRowGroup): string | null {
  const reason = statusReasonForGroup(group);
  if (reason == null) return null;
  const last = lastPriceCentsFor(group);
  return isUnpriced(last) ? reason : `${reason} · last ${money(last)}`;
}

/** A section head's counts, per status inside that section and spelling both nouns, exactly like the
 * by-location line (and for the same reason -- a bare number here could be read as either unit). A
 * status with nothing in it under the current filter prints nothing at all rather than "0 trial". */
function sectionCountLabel(statuses: readonly ProviderSubscriberRow["status"][], groups: AccountRowGroup[]): string {
  return statuses
    .map((status) => {
      const inStatus = groups.filter((g) => statusForGroup(g) === status);
      if (inStatus.length === 0) return null;
      const c = countsOf(inStatus);
      return locationCountLabel(c.feeds, c.clients, STATUS_WORD[status]);
    })
    .filter(Boolean)
    .join("; ");
}

/** One row-shape for a group, hoisted out of the table body when the body grew sections: the
 * package and single shapes are unchanged, and rendering them from one place is what stops a
 * section from quietly acquiring a different row than the one the unsectioned list showed. */
function groupRow(group: AccountRowGroup) {
  if (group.kind === "package") {
    return (
      <AccountPackageRows
        key={`${group.pseudonym}-${group.label}`}
        pseudonym={group.pseudonym}
        label={group.label}
        status={group.status}
        reason={reasonLine(group)}
        share={providerShareFor(group.status, resolvedPriceCentsFor(group))}
        serverIp={group.members[0].serverIp ?? null}
        sinceISO={startedAtForGroup(group).toISOString().slice(0, 10)}
        members={group.members.map((m) => ({
          subscriptionId: m.subscriptionId,
          tierName: m.tierName,
          status: m.status,
          startedAtISO: m.startedAt.toISOString().slice(0, 10),
        }))}
      />
    );
  }
  return (
    <tr key={group.row.subscriptionId}>
      <td>
        <b className="mono">{group.row.pseudonym}</b>
      </td>
      <td>{group.row.tierName}</td>
      <td>
        <span className={`tb ${group.row.status}`}>
          {STATUS_ICON[group.row.status] ?? "•"} {group.row.status}
        </span>
        {reasonLine(group) && <div className="sub muted">{reasonLine(group)}</div>}
      </td>
      <td className="r share">{providerShareFor(group.row.status, resolvedPriceCentsFor(group))}</td>
      <td className="mono">{group.row.serverIp ?? ""}</td>
      <td className="r mono">{group.row.startedAt.toISOString().slice(0, 10)}</td>
    </tr>
  );
}

/** Bus thread provider-feed-subscriber-linkage-2026-08-29, item 3. Pseudonym-only view --
 * see feed-subscriptions.ts's listSubscribersForProvider() for why no email/name/user_id
 * ever reaches this template. Reads real rows once migration 0071 is applied; the query
 * degrades to an empty list before that, so this page just shows the empty state today. */
export default async function FeedSubscribersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const filter: SubscriberFilter = sp.status && isSubscriberFilter(sp.status) ? sp.status : "all";

  const session = await auth();
  const providerId = session!.user!.id!;

  const subscribers = await listSubscribersForProvider(providerId);
  const accountGroups = groupAccountSubscriptions(subscribers);
  const hiddenRowCount = await countUnpseudonymedRowsForProvider(providerId);

  /** Counts are per group status, not per row status, so the number on a button is exactly how
   * many rows that button reveals. They are also computed over ALL groups, never the filtered set:
   * a filter must not be able to change the size of the thing it filters. */
  const countsFor = (status: ProviderSubscriberRow["status"]) =>
    countsOf(accountGroups.filter((g) => statusForGroup(g) === status));
  const counts = { paying: countsFor("active"), trial: countsFor("trial"), lapsed: countsFor("lapsed") };
  /** Every button counts CLIENTS, the unit coxwell's header already spoke in ("2 PAYING CLIENTS").
   * A client in two statuses (HH1 pays for one package and trials another) is counted under each,
   * so these three do not have to add up to All -- the by-location line under the table spells
   * both units for exactly this reason. */
  const allClientCount = new Set(subscribers.map((s) => s.pseudonym)).size;
  const visibleGroups =
    filter === "all" ? accountGroups : accountGroups.filter((g) => statusForGroup(g) === FILTER_STATUS[filter]);
  const visibleRows = visibleGroups.flatMap(rowsOf);
  const visibleClientCount = new Set(visibleRows.map((s) => s.pseudonym)).size;

  /** Sections are cut from the VISIBLE groups, so they describe what is on screen under the current
   * filter and nothing else -- the same rule the "By location" line follows. The heads only appear
   * when there is actually more than one section to tell apart: under Paying or Lapsed the button
   * above already names the one status present, and a lone "Lapsed" bar over a lapsed-only table
   * would be a label with nothing to distinguish. */
  const sections = SECTIONS.map((def) => ({
    ...def,
    groups: orderGroups(
      def.key,
      visibleGroups.filter((g) => def.statuses.includes(statusForGroup(g)))
    ),
  })).filter((s) => s.groups.length > 0);
  const showSectionHeads = sections.length > 1;

  /** Job A2 (marcus/coxwell, bus thread leo-provider-subscribers-page-2026-09-06): "LD Base =
   * $30/mo and NY Base = $30/mo, flat 50/50" -- foots the same providerShareCentsFor()/-For()
   * pair every row cell already uses, so the total can never disagree with the sum a reader
   * would get by adding up the visible cells themselves. Job C: each row now resolves its OWN
   * price (client override only, no package/tier default -- m46504) via resolvedPriceCentsFor.
   * Per marcus's m46511/m46518 ruling, this calls sumProviderShareCents (feed-subscriptions.ts)
   * on the same accountGroups already in memory rather than reducing them here itself -- the
   * Overview card and Revenue's Total row call the identical function, so a lapsed row, a null
   * price, or a second region can't make this footer disagree with either of them. */
  const totalShareCents = sumProviderShareCents(accountGroups);
  /** C3 (marcus m49063): every row cell here now spells an unknown price "unpriced" (null or a
   * recut 0, via providerShareFor), so the footer must not be the one surface that still prints
   * "$0" for a column of them. priced === 0 means nothing behind this total has a price at all;
   * priced < subscribers means the figure covers fewer rows than the table above it shows.
   *
   * The count qualifier goes on the FOOTER only, not in the header cap: its unit is the paying
   * row (one client-package line, so HH1's LD Base and NY Base count twice), which is neither of
   * the two units the cap already packs into one sentence ("N paying clients · M feeds"). Same
   * reason locationCountLabel above spells both nouns -- a bare "2 of 7" in that string could be
   * read against either. Under the table, the rows it counts are on screen. */
  const shareCounts = pricedGroupCounts(accountGroups);

  /** "the location line filters with it" (m49101): this walks the VISIBLE rows, so switching to
   * Lapsed leaves a by-location line that describes the lapsed rows on screen and nothing else. */
  const byLocation = new Map<
    string,
    { paying: number; trial: number; lapsed: number; payingClients: Set<string>; trialClients: Set<string>; lapsedClients: Set<string> }
  >();
  for (const s of visibleRows) {
    const location = (s.regionKey && isFeedRegion(s.regionKey) && FEED_REGION_LABELS[s.regionKey]) || OTHER_LOCATION;
    const counts =
      byLocation.get(location) ??
      { paying: 0, trial: 0, lapsed: 0, payingClients: new Set<string>(), trialClients: new Set<string>(), lapsedClients: new Set<string>() };
    if (s.status === "active") {
      counts.paying++;
      counts.payingClients.add(s.pseudonym);
    } else if (s.status === "trial") {
      counts.trial++;
      counts.trialClients.add(s.pseudonym);
    } else {
      counts.lapsed++;
      counts.lapsedClients.add(s.pseudonym);
    }
    byLocation.set(location, counts);
  }

  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>Subscribers</h1>
          <div className="crumb">feed.horizonhft.com / subscribers</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        <div className="card full">
          <div className="chead">
            <span className="ic">◎</span>
            <h3>Subscribers</h3>
            {/* The cap still carries the FEED count coxwell was reading in the header ("· 6
                FEEDS"), now describing whatever the filter shows; only the per-status client
                numbers moved onto the buttons. The money is paying-only under every filter -- the
                same sumProviderShareCents the footer and Revenue call -- so filtering the roster
                never moves it. */}
            <span className="cap">
              {filter === "all"
                ? `${allClientCount} client${allClientCount === 1 ? "" : "s"} · ${subscribers.length} feeds`
                : countLabel(visibleRows.length, visibleClientCount, filter)}{" "}
              · {shareCounts.priced === 0 ? UNPRICED_LABEL : `${money(totalShareCents)}/mo`}
            </span>
            <div className="chead-tools">
              <div className="seg">
                <Link href={hrefFor("all")} className={filter === "all" ? "on" : ""}>
                  All<span className="n">{allClientCount}</span>
                </Link>
                <Link href={hrefFor("paying")} className={filter === "paying" ? "on" : ""}>
                  Paying<span className="n">{counts.paying.clients}</span>
                </Link>
                <Link href={hrefFor("trial")} className={filter === "trial" ? "on" : ""}>
                  Trial<span className="n">{counts.trial.clients}</span>
                </Link>
                <Link href={hrefFor("lapsed")} className={filter === "lapsed" ? "on" : ""}>
                  Lapsed<span className="n">{counts.lapsed.clients}</span>
                </Link>
              </div>
            </div>
          </div>

          {subscribers.length > 0 && (
            <div className="scope-note">
              <span className="i">◈</span>
              <span>
                By location —{" "}
                {Array.from(byLocation.entries())
                  .map(([location, c]) => {
                    const parts = [
                      c.paying > 0 ? locationCountLabel(c.paying, c.payingClients.size, "paying") : null,
                      c.trial > 0 ? locationCountLabel(c.trial, c.trialClients.size, "trial") : null,
                      c.lapsed > 0 ? locationCountLabel(c.lapsed, c.lapsedClients.size, "lapsed") : null,
                    ].filter(Boolean);
                    return `${location}: ${parts.join("; ")}`;
                  })
                  .join("   |   ")}
              </span>
            </div>
          )}

          {/* m49127, same line as Revenue's: a row this page cannot show is said out loud, not
              silently dropped. Normal state is zero and renders nothing. */}
          {hiddenRowCount > 0 && (
            <div className="scope-note">
              <span className="i">◈</span>
              <span className="muted">
                {hiddenRowCount} subscription row{hiddenRowCount === 1 ? " is" : "s are"} not shown (no client
                pseudonym).
              </span>
            </div>
          )}

          {subscribers.length === 0 ? (
            <div className="empty">
              <div className="eic">◎</div>
              <b>No subscribers yet</b>
              <p>
                Every account that subscribes to one of your tiers shows up here as a pseudonym — Horizon never
                surfaces a subscriber&apos;s name or email to providers.
              </p>
            </div>
          ) : visibleGroups.length === 0 ? (
            <div className="empty">
              <div className="eic">◎</div>
              <b>No {filter} clients</b>
              <p>
                Every one of your {allClientCount} clients is under another filter — switch back to All above.
              </p>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Tier</th>
                  <th>Status</th>
                  <th className="r">Your 50%*</th>
                  <th>Server IP</th>
                  <th className="r">Since</th>
                </tr>
              </thead>
              <tbody>
                <tr className="note-row">
                  <td colSpan={6} className="r">
                    * Notional list-price split — there is no payout ledger or per-subscriber billing yet.
                  </td>
                </tr>
                {sections.map((section) => (
                  <Fragment key={section.key}>
                    {showSectionHeads && (
                      <tr className="section-row">
                        <td colSpan={6}>
                          <b>{section.label}</b>
                          <span className="n">{sectionCountLabel(section.statuses, section.groups)}</span>
                        </td>
                      </tr>
                    )}
                    {section.groups.map((g) => groupRow(g))}
                  </Fragment>
                ))}
                <tr className="total-row">
                  <td colSpan={3} className="r">
                    <b>Total</b>
                    <div className="sub">paying clients only</div>
                  </td>
                  <td className="r share">
                    <b>{moneyOrUnpriced(totalShareCents, shareCounts.priced)}</b>
                    {shareCounts.priced < shareCounts.subscribers && (
                      <div className="sub">
                        {shareCounts.priced} of {shareCounts.subscribers} paying rows priced
                      </div>
                    )}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="foot">HORIZON HFT · provider panel · Subscribers</div>
      </section>
    </>
  );
}
