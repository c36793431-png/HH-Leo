import { formatAbsoluteUtc } from "@/lib/format-time";
import type { HistoryRow, HistoryStatus } from "@/lib/my-requests-history";

const PILL_CLASS: Record<HistoryStatus, string> = {
  Sent: "bk-pill-sent",
  "In review": "bk-pill-review",
  Approved: "bk-pill-approved",
  Declined: "bk-pill-declined",
  Handled: "bk-pill-handled",
  Active: "bk-pill-active",
  Ended: "bk-pill-ended",
};

/**
 * The history rows, one per request (a click is one row; per-item statuses when they differ, m59992), as drawn on
 * /marketplace/requests ("My requests") and on /feeds ("My feed requests", marcus m63907). One component, so the
 * two pages can never draw the same row differently. Handled stays neutral grey, never green: handled can include a no.
 */
export function HistoryRowList({ rows }: { rows: HistoryRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <div key={r.key} className="bk-req">
          <div className="bk-req-when">
            {formatAbsoluteUtc(r.at)}
            <small>{r.reference}</small>
          </div>
          <ul className="bk-req-lines">
            <li className="bk-req-kind">{r.kind}</li>
            {r.items.map((item, i) => (
              <li key={i} className={item === "Start with a 30-day trial" ? "bk-req-trial" : undefined}>
                {item}
                {r.itemStatuses?.[i] && <span>{`: ${r.itemStatuses[i]}`}</span>}
              </li>
            ))}
          </ul>
          <div className="bk-req-status">
            <span className={`bk-pill ${PILL_CLASS[r.status]}`}>{r.status}</span>
            {r.outcome && <small>{r.outcome}</small>}
          </div>
        </div>
      ))}
    </>
  );
}
