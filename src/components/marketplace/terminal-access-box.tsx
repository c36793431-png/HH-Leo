import Link from "next/link";
import type { LicenseDetail } from "@/lib/licenses";
import type { SignalFeedCard } from "@/lib/signal-feed-cards";
import { LicenseStatusCompact } from "@/components/license-status-card";

/**
 * The terminal product page's Access box contents: the "download" listing's action. Self-contained
 * so Iris's v2 page can drop it in whole (marcus, m53069).
 *
 * LICENSED means `licenses.length > 0`, and `licenses` is getActiveLicenseDetailsForUser, the read
 * /dashboard's License status card renders from. It is the same predicate as isPaidUser (same WHERE),
 * taken from ONE read, so the box cannot say licensed while its own licence list is empty.
 *
 * Licensed (coxwell 2026-09-24 ~00:2xZ via marcus, m53069: "above the license still now missing so
 * they can pick like feeds"): the dashboard's licence card, compact; the dashboard's four Signal
 * Feed cards with their live state and the same Upgrade/See tiers links; and Downloads, kept as a
 * button. Everyone else: Request access to Telegram, unchanged from 9c831bf (m53009 (a)).
 */
export function TerminalAccessBox({
  licenses,
  feeds,
  download,
  requestHref,
}: {
  licenses: LicenseDetail[];
  feeds: SignalFeedCard[];
  download: { href: string; label: string };
  requestHref: string;
}) {
  if (licenses.length === 0) {
    return (
      <a className="btn primary sm mkd-action" href={requestHref} target="_blank" rel="noopener noreferrer">
        Request access →
      </a>
    );
  }

  const activeCount = feeds.filter((f) => f.pill.color === "green").length;
  return (
    <>
      {/* One row per active licence, HH badge only when there is more than one: the dashboard's rule. */}
      {licenses.map((license) => (
        <LicenseStatusCompact key={license.id} license={license} showBadge={licenses.length > 1} />
      ))}

      <div className="mkd-feeds">
        <div className="mkd-feeds-head">
          <span className="mkd-plate-title">Signal feeds</span>
          <span className="mkd-feeds-count">
            {activeCount} of {feeds.length} active
          </span>
        </div>
        {feeds.map((f) => (
          <div key={f.feedType} className="sf-card mkd-feed">
            <div className="sf-top">
              <span className={`sf-flag fi fi-${f.countryCode.toLowerCase()}`} role="img" aria-label={`${f.countryCode} flag`} />
              <b className="sf-name">{f.name.replace(/ Feed$/, "")}</b>
              <span className={`sf-pill sf-pill-${f.pill.color}`}>● {f.pill.label}</span>
              <Link className="sf-action" href={f.action.href}>
                {f.action.label}
              </Link>
            </div>
          </div>
        ))}
      </div>

      <Link href={download.href} className="btn primary sm mkd-action">
        {download.label}
      </Link>
    </>
  );
}
