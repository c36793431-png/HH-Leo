import Link from "next/link";
import type { TradingAlertRow } from "@/lib/trading-alerts";
import { formatRelative } from "@/lib/format-time";

const ALERT_TYPE_META: Record<string, { icon: string; cls: string; label: string }> = {
  profit: { icon: "▲", cls: "profit", label: "Profit" },
  loss: { icon: "▼", cls: "loss", label: "Loss" },
  info: { icon: "●", cls: "info", label: "Info" },
};

function alertTypeMeta(alertType: string) {
  return ALERT_TYPE_META[alertType] ?? { icon: "●", cls: "info", label: alertType };
}

function maskLicenseTag(key: string): string {
  return `••${key.slice(-4)}`;
}

export function RecentAlertsPanel({
  alerts,
  showLicenseTag,
  viewAllHref,
  emptyStateHref,
}: {
  alerts: TradingAlertRow[];
  showLicenseTag: boolean;
  /** Omit on the full-history page — there's nowhere further to link. */
  viewAllHref?: string;
  emptyStateHref: string;
}) {
  return (
    <div className="card full" id="alerts">
      <div className="chead">
        <span className="ic">⚡</span>
        <h3>Recent Alerts</h3>
        {viewAllHref && (
          <Link className="cap" href={viewAllHref}>
            View all →
          </Link>
        )}
      </div>
      {alerts.length === 0 ? (
        <div className="empty">
          <div className="eic">⚡</div>
          <b>No alerts yet</b>
          <p>
            Alerts from the Horizon terminal show up here once your license is linked to Telegram.{" "}
            <Link href={emptyStateHref}>Link Telegram to receive alerts →</Link>
          </p>
        </div>
      ) : (
        <div className="rows alert-rows">
          {alerts.map((a) => {
            const meta = alertTypeMeta(a.alertType);
            return (
              <div className="rw alert-row" key={a.id}>
                <div className={`ricon alert-ic ${meta.cls}`}>{meta.icon}</div>
                <div className="rmeta">
                  <b>
                    {a.symbol ?? meta.label}
                    {showLicenseTag && a.licenseKey && (
                      <span className="alert-lic-tag">{maskLicenseTag(a.licenseKey)}</span>
                    )}
                  </b>
                  <span>{a.message}</span>
                </div>
                <div className="alert-rcta-col">
                  {a.pnl !== null && <span className={`alert-pnl ${meta.cls}`}>{a.pnl}</span>}
                  <span className="alert-ts">{formatRelative(a.createdAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
