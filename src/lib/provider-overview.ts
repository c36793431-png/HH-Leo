import { pool } from "./db";
import type { MonthlyHistoryEntry } from "./feed-subscriptions";

/** The provider Overview's derived figures (P1, marcus m64242 + m64316). Everything here reads the
 * same rows the panel already reads -- the month entries of getProviderRevenueSummary and
 * feed_subscriptions -- and adds no second source for any number the panel shows. */

/** "YYYY-MM" on the UTC calendar, the key buildMonthlyHistory gives each month. */
export function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function previousMonthKeyOf(d: Date): string {
  return monthKeyOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)));
}

/** Every client in the month carries a price. Only then is the month's gross a real figure: a
 * month with an unpriced client would compare or split a part as if it were the whole. */
function fullyPriced(m: MonthlyHistoryEntry | null): m is MonthlyHistoryEntry {
  return m != null && m.clients > 0 && m.pricedClients === m.clients;
}

export interface ThisMonthShare {
  /** This calendar month's entry; null when History has no row for it (no client ever). */
  month: MonthlyHistoryEntry | null;
  /** Whole-percent change of the provider's share against last month. null = no honest
   * comparison: either month has no client or an unpriced one, or last month's share is 0. */
  changePct: number | null;
  /** Horizon's part of this month's contracted gross (gross - share, the same subtraction the
   * Earnings page uses, never a second halving). null unless the month is fully priced. */
  horizonCents: number | null;
}

export function thisMonthShare(months: MonthlyHistoryEntry[], now: Date): ThisMonthShare {
  const month = months.find((m) => m.monthKey === monthKeyOf(now)) ?? null;
  const prev = months.find((m) => m.monthKey === previousMonthKeyOf(now)) ?? null;
  const changePct =
    fullyPriced(month) && fullyPriced(prev) && prev.shareCents > 0
      ? Math.round(((month.shareCents - prev.shareCents) / prev.shareCents) * 100)
      : null;
  return { month, changePct, horizonCents: fullyPriced(month) ? month.grossCents - month.shareCents : null };
}

/** Clients whose FIRST grant from this provider started in the last `days` days. Paid and trial
 * both write feed_subscriptions, so both count; a returning client's new row does not. */
export async function countNewClientsForProvider(providerUserId: string, now: Date, days = 7): Promise<number> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const result = await pool.query<{ count: string }>(
    `select count(*) as count from (
       select min(started_at) as first_started_at
       from feed_subscriptions
       where provider_user_id = $1
       group by subscriber_user_id
     ) f
     where f.first_started_at >= $2`,
    [providerUserId, since]
  );
  return Number(result.rows[0]?.count ?? 0);
}
