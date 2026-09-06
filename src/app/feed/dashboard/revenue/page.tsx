import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { PackageRevenueRow } from "@/components/feed/package-revenue-rows";
import {
  listSubscribersForProvider,
  groupAccountSubscriptions,
  resolvedPriceCentsFor,
  sumProviderShareCents,
  sumMonthlyGrossCents,
  type AccountRowGroup,
} from "@/lib/feed-subscriptions";
import { providerShareCentsFor } from "@/lib/feed-provider-packages";

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
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
    const status = g.kind === "package" ? g.status : g.row.status;
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

export default async function FeedRevenuePage() {
  const session = await auth();
  const subscribers = await listSubscribersForProvider(session!.user!.id!);
  const accountGroups = groupAccountSubscriptions(subscribers);
  const groups = buildPackageRevenueGroups(accountGroups);
  /** Per marcus's m46511/m46518/m46522 rulings (same summation everywhere): both totals below
   * are the identical functions Subscribers' footer and the Overview card call, on the same
   * accountGroups this page already grouped -- never a second reduce over the by-package rows
   * above, gross or split. */
  const totalMonthlyCents = sumMonthlyGrossCents(accountGroups);
  const totalShareCents = sumProviderShareCents(accountGroups);

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
            <h3>By package</h3>
            <span className="cap">paying subscribers</span>
          </div>
          {groups.length === 0 ? (
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
                {groups.map((g) => (
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
